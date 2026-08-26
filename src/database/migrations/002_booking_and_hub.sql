-- ============================================================
-- MediClick — Migración 002
-- Reservas públicas + Hub de obras sociales
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- Uso en el VPS:
--   docker exec -i mediclick-db psql -U mediclick -d mediclick < 002_booking_and_hub.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ═══════════════════════════════════════════════════════════
-- SISTEMA DE RESERVAS PÚBLICAS (link para pacientes)
-- ═══════════════════════════════════════════════════════════

DO $$ BEGIN
    CREATE TYPE booking_mode AS ENUM (
    'open',              -- Reserva libre, sin requisitos
    'approval',          -- Requiere que el médico apruebe
    'deposit',           -- Requiere seña
    'deposit_approval'   -- Seña + aprobación
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_method AS ENUM ('transfer', 'cash', 'both');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE payment_status AS ENUM ('pending', 'proof_uploaded', 'confirmed', 'rejected', 'refunded');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE booking_status AS ENUM (
    'pending_payment',   -- Esperando seña
    'pending_approval',  -- Esperando aprobación del médico
    'confirmed',         -- Confirmado
    'rejected',          -- Rechazado por el médico
    'cancelled',         -- Cancelado por el paciente
    'expired'            -- Venció el tiempo para pagar
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── CONFIGURACIÓN DE RESERVAS POR MÉDICO/ORG ──────────────

CREATE TABLE IF NOT EXISTS booking_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_doctor_id UUID UNIQUE NOT NULL REFERENCES organization_doctors(id) ON DELETE CASCADE,
    
    -- ¿Está activa la reserva online?
    is_enabled BOOLEAN DEFAULT false,
    
    -- Slug público para el link (ej: /reservar/dr-garcia)
    public_slug VARCHAR(100) UNIQUE,
    
    -- Modalidad de reserva
    booking_mode booking_mode DEFAULT 'open',
    
    -- ─── Seña ───
    requires_deposit BOOLEAN DEFAULT false,
    deposit_amount DECIMAL(10,2),
    deposit_percentage INT,                          -- O un % del valor de consulta
    consultation_fee DECIMAL(10,2),                  -- Valor de la consulta
    payment_methods payment_method DEFAULT 'both',
    
    -- Datos bancarios para transferencia
    bank_name VARCHAR(100),
    bank_account_holder VARCHAR(200),
    bank_cbu VARCHAR(30),
    bank_alias VARCHAR(50),
    
    -- Tiempo límite para pagar la seña (minutos)
    payment_deadline_minutes INT DEFAULT 120,
    
    -- ─── Política de no-show ───
    charge_on_no_show BOOLEAN DEFAULT false,
    no_show_fee DECIMAL(10,2),                       -- Cuánto cobra si no viene
    keeps_deposit_on_no_show BOOLEAN DEFAULT true,   -- Se queda con la seña
    
    -- ─── Cancelación ───
    min_hours_before_cancel INT DEFAULT 24,          -- Mínimo para cancelar sin cargo
    refund_on_early_cancel BOOLEAN DEFAULT true,
    
    -- ─── Restricciones ───
    max_days_in_advance INT DEFAULT 60,              -- Hasta cuándo se puede reservar
    min_hours_in_advance INT DEFAULT 2,              -- Anticipación mínima
    allow_new_patients BOOLEAN DEFAULT true,
    requires_insurance_info BOOLEAN DEFAULT false,
    
    -- ─── Receta anticipada ───
    -- Si el médico genera la receta antes de la consulta
    allows_prepaid_prescription BOOLEAN DEFAULT false,
    prescription_requires_payment BOOLEAN DEFAULT true,
    
    -- ─── Mensajes personalizados ───
    welcome_message TEXT,
    instructions TEXT,                               -- Instrucciones para el paciente
    cancellation_policy_text TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_settings_slug ON booking_settings(public_slug) WHERE is_enabled = true;
CREATE INDEX IF NOT EXISTS idx_booking_settings_orgdoc ON booking_settings(org_doctor_id);

-- ─── SOLICITUDES DE RESERVA (desde el link público) ────────

CREATE TABLE IF NOT EXISTS booking_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_doctor_id UUID NOT NULL REFERENCES organization_doctors(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id),
    
    -- Si el paciente ya existe en el sistema
    patient_id UUID REFERENCES patients(id),
    
    -- Datos del solicitante (si es paciente nuevo)
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    dni VARCHAR(20),
    email VARCHAR(255),
    phone VARCHAR(20) NOT NULL,
    date_of_birth DATE,
    
    -- Obra social
    insurance_provider VARCHAR(200),
    insurance_number VARCHAR(50),
    
    -- Turno solicitado
    requested_date DATE NOT NULL,
    requested_start_time TIME NOT NULL,
    requested_end_time TIME NOT NULL,
    reason TEXT,
    is_first_visit BOOLEAN DEFAULT true,
    
    -- Estado
    status booking_status DEFAULT 'pending_approval',
    
    -- Pago
    deposit_required DECIMAL(10,2),
    payment_status payment_status DEFAULT 'pending',
    payment_method VARCHAR(20),                      -- transfer | cash
    payment_proof_url TEXT,                          -- Comprobante subido
    payment_reference VARCHAR(100),                  -- Nro de operación
    payment_confirmed_at TIMESTAMPTZ,
    payment_deadline TIMESTAMPTZ,
    
    -- Token de confirmación (para links de email/whatsapp)
    confirmation_token VARCHAR(64) UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
    
    -- Turno creado si se aprueba
    appointment_id UUID REFERENCES appointments(id),
    
    -- Revisión del médico
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES doctors(id),
    rejection_reason TEXT,
    
    -- Metadata
    source VARCHAR(50) DEFAULT 'public_link',        -- public_link, instagram, whatsapp
    ip_address INET,
    user_agent TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_req_orgdoc ON booking_requests(org_doctor_id, status);
CREATE INDEX IF NOT EXISTS idx_booking_req_date ON booking_requests(requested_date);
CREATE INDEX IF NOT EXISTS idx_booking_req_token ON booking_requests(confirmation_token);
CREATE INDEX IF NOT EXISTS idx_booking_req_phone ON booking_requests(phone);
CREATE INDEX IF NOT EXISTS idx_booking_req_pending ON booking_requests(org_doctor_id) WHERE status IN ('pending_payment', 'pending_approval');

-- ─── PAGOS / SEÑAS ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    booking_request_id UUID REFERENCES booking_requests(id),
    appointment_id UUID REFERENCES appointments(id),
    patient_id UUID REFERENCES patients(id),
    
    amount DECIMAL(10,2) NOT NULL,
    method VARCHAR(20) NOT NULL,                     -- transfer | cash
    status payment_status DEFAULT 'pending',
    
    -- Comprobante
    proof_url TEXT,
    reference VARCHAR(100),
    
    -- Tipo de pago
    payment_type VARCHAR(30) DEFAULT 'deposit',      -- deposit | consultation | no_show_fee
    
    -- Confirmación
    confirmed_by UUID REFERENCES doctors(id),
    confirmed_at TIMESTAMPTZ,
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_org ON payments(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_request_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- ─── SLOTS BLOQUEADOS TEMPORALMENTE ────────────────────────
-- Cuando alguien está reservando, se bloquea el slot X minutos

CREATE TABLE IF NOT EXISTS slot_holds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_doctor_id UUID NOT NULL REFERENCES organization_doctors(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    
    booking_request_id UUID REFERENCES booking_requests(id) ON DELETE CASCADE,
    session_id VARCHAR(100),
    
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slot_holds ON slot_holds(org_doctor_id, date, start_time);
CREATE INDEX IF NOT EXISTS idx_slot_holds_expiry ON slot_holds(expires_at);

-- ─── TRIGGERS ───────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_booking_settings_upd ON booking_settings
;
CREATE TRIGGER trg_booking_settings_upd BEFORE UPDATE ON booking_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_booking_req_upd ON booking_requests
;
CREATE TRIGGER trg_booking_req_upd BEFORE UPDATE ON booking_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_payments_upd ON payments
;
CREATE TRIGGER trg_payments_upd BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── LIMPIEZA DE HOLDS VENCIDOS ────────────────────────────

CREATE OR REPLACE FUNCTION cleanup_expired_holds()
RETURNS void AS $$
BEGIN
    DELETE FROM slot_holds WHERE expires_at < NOW();
    
    UPDATE booking_requests
    SET status = 'expired'
    WHERE status = 'pending_payment'
      AND payment_deadline < NOW();
END;
$$ LANGUAGE plpgsql;

-- ─── VISTA: Perfil público del médico ──────────────────────

CREATE OR REPLACE VIEW v_public_doctor_profile AS
SELECT
    bs.public_slug,
    bs.is_enabled,
    bs.booking_mode,
    bs.requires_deposit,
    bs.deposit_amount,
    bs.consultation_fee,
    bs.payment_methods,
    bs.bank_name,
    bs.bank_account_holder,
    bs.bank_cbu,
    bs.bank_alias,
    bs.payment_deadline_minutes,
    bs.min_hours_before_cancel,
    bs.max_days_in_advance,
    bs.min_hours_in_advance,
    bs.allow_new_patients,
    bs.requires_insurance_info,
    bs.welcome_message,
    bs.instructions,
    bs.cancellation_policy_text,
    od.id AS org_doctor_id,
    d.id AS doctor_id,
    d.first_name || ' ' || d.last_name AS doctor_name,
    d.specialty,
    d.avatar_url,
    d.medical_license,
    o.id AS organization_id,
    o.name AS org_name,
    o.type AS org_type,
    o.address,
    o.city,
    o.province,
    o.phone AS org_phone,
    o.logo_url,
    o.primary_color
FROM booking_settings bs
JOIN organization_doctors od ON od.id = bs.org_doctor_id
JOIN doctors d ON d.id = od.doctor_id
JOIN organizations o ON o.id = od.organization_id
WHERE bs.is_enabled = true AND od.is_active = true;

-- ═══════════════════════════════════════════════════════════
-- HUB DE INTEGRACIÓN CON OBRAS SOCIALES
-- ═══════════════════════════════════════════════════════════

DO $$ BEGIN
    CREATE TYPE connector_kind AS ENUM ('api', 'portal', 'manual', 'offline');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE connector_health AS ENUM ('healthy', 'degraded', 'down', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    CREATE TYPE validation_result AS ENUM ('approved', 'rejected', 'pending', 'error', 'manual_review');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── PADRÓN DE FINANCIADORES ────────────────────────────────
-- Catálogo maestro nacional. Se carga una vez y se mantiene.

CREATE TABLE IF NOT EXISTS insurers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Identificación oficial
    rnos_code VARCHAR(20) UNIQUE,              -- Código RNOS de SSSalud
    cuit VARCHAR(13),
    name VARCHAR(200) NOT NULL,
    short_name VARCHAR(60),
    kind VARCHAR(30) DEFAULT 'obra_social',    -- obra_social | prepaga | mutual | provincial

    -- Alcance
    province VARCHAR(100),                      -- NULL = nacional
    is_national BOOLEAN DEFAULT true,

    -- Branding
    logo_url TEXT,
    brand_color VARCHAR(7),

    -- Estado
    is_active BOOLEAN DEFAULT true,
    affiliate_count INT,                        -- Para priorizar integraciones

    aliases TEXT[],                             -- ["OSDE","O.S.D.E.","Organización de Servicios Directos"]

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insurers_rnos ON insurers(rnos_code);
CREATE INDEX IF NOT EXISTS idx_insurers_name ON insurers USING gin(to_tsvector('spanish', name));
CREATE INDEX IF NOT EXISTS idx_insurers_province ON insurers(province) WHERE is_active;

-- ─── PLANES POR FINANCIADOR ─────────────────────────────────

CREATE TABLE IF NOT EXISTS insurer_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    insurer_id UUID NOT NULL REFERENCES insurers(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    UNIQUE(insurer_id, code)
);

CREATE INDEX IF NOT EXISTS idx_plans_insurer ON insurer_plans(insurer_id);

-- ─── CONECTORES ─────────────────────────────────────────────
-- Cómo hablamos con cada financiador. Un financiador puede
-- tener varios conectores con prioridad (fallback chain).

CREATE TABLE IF NOT EXISTS connectors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    insurer_id UUID NOT NULL REFERENCES insurers(id) ON DELETE CASCADE,

    adapter_key VARCHAR(60) NOT NULL,          -- 'osde_api' | 'swiss_portal' | 'generic_manual'
    kind connector_kind NOT NULL,
    priority INT DEFAULT 100,                   -- Menor = se intenta primero

    -- Capacidades que soporta este conector
    can_validate_affiliate BOOLEAN DEFAULT false,
    can_authorize_practice BOOLEAN DEFAULT false,
    can_submit_batch BOOLEAN DEFAULT false,
    can_query_status BOOLEAN DEFAULT false,

    -- Config específica del adaptador (URLs, endpoints, selectores)
    config JSONB DEFAULT '{}',

    -- Salud del conector
    health connector_health DEFAULT 'unknown',
    last_success_at TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    consecutive_failures INT DEFAULT 0,
    avg_latency_ms INT,

    -- Rate limiting
    max_requests_per_minute INT DEFAULT 30,

    is_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connectors_insurer ON connectors(insurer_id, priority) WHERE is_enabled;
CREATE INDEX IF NOT EXISTS idx_connectors_health ON connectors(health);

-- ─── CREDENCIALES DEL PRESTADOR ─────────────────────────────
-- Cada consultorio guarda sus credenciales de cada portal.
-- Cifradas con pgcrypto usando la clave de la app.

CREATE TABLE IF NOT EXISTS provider_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    insurer_id UUID NOT NULL REFERENCES insurers(id) ON DELETE CASCADE,

    -- Identificación del prestador ante esa obra social
    provider_code VARCHAR(60),                  -- Nro de prestador
    provider_cuit VARCHAR(13),

    -- Credenciales cifradas (bytea con pgp_sym_encrypt)
    username_enc BYTEA,
    password_enc BYTEA,
    extra_enc BYTEA,                            -- JSON con tokens, certificados, etc.

    -- Estado
    is_valid BOOLEAN DEFAULT true,
    last_verified_at TIMESTAMPTZ,
    last_error TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(organization_id, insurer_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_creds_org ON provider_credentials(organization_id);

-- ─── SOLICITUDES AL HUB ─────────────────────────────────────
-- Toda operación contra una obra social pasa por acá.

CREATE TABLE IF NOT EXISTS hub_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    insurer_id UUID NOT NULL REFERENCES insurers(id),
    connector_id UUID REFERENCES connectors(id),

    operation VARCHAR(40) NOT NULL,             -- validate | authorize | submit_batch | query
    idempotency_key VARCHAR(100),

    -- Entrada normalizada
    payload JSONB NOT NULL,

    -- Salida normalizada
    result validation_result,
    response JSONB,
    authorization_code VARCHAR(60),
    error_code VARCHAR(60),
    error_message TEXT,

    -- Trazabilidad
    attempts INT DEFAULT 0,
    latency_ms INT,
    raw_response TEXT,                          -- Para debug de portales

    -- Referencias
    patient_id UUID REFERENCES patients(id),
    appointment_id UUID REFERENCES appointments(id),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hub_req_org ON hub_requests(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hub_req_insurer ON hub_requests(insurer_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_req_idem ON hub_requests(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hub_req_pending ON hub_requests(operation) WHERE result = 'pending';

-- ─── CACHÉ DE VALIDACIONES ──────────────────────────────────
-- Un afiliado validado hace 10 minutos no se revalida.

CREATE TABLE IF NOT EXISTS affiliate_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    insurer_id UUID NOT NULL REFERENCES insurers(id) ON DELETE CASCADE,
    affiliate_number VARCHAR(60) NOT NULL,
    document_number VARCHAR(20),

    is_valid BOOLEAN,
    full_name VARCHAR(200),
    plan_code VARCHAR(50),
    plan_name VARCHAR(200),
    coverage JSONB DEFAULT '{}',

    validated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,

    UNIQUE(insurer_id, affiliate_number)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_cache_lookup ON affiliate_cache(insurer_id, affiliate_number);
CREATE INDEX IF NOT EXISTS idx_affiliate_cache_doc ON affiliate_cache(insurer_id, document_number);
CREATE INDEX IF NOT EXISTS idx_affiliate_cache_exp ON affiliate_cache(expires_at);

-- ─── NOMENCLADORES ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nomenclators (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    insurer_id UUID REFERENCES insurers(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

    name VARCHAR(200) NOT NULL,
    source VARCHAR(60),                         -- 'nacional' | 'colegio' | 'convenio' | 'propio'
    valid_from DATE NOT NULL,
    valid_to DATE,
    is_active BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nomenclators_insurer ON nomenclators(insurer_id, valid_from DESC);
CREATE INDEX IF NOT EXISTS idx_nomenclators_org ON nomenclators(organization_id);

CREATE TABLE IF NOT EXISTS nomenclator_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nomenclator_id UUID NOT NULL REFERENCES nomenclators(id) ON DELETE CASCADE,

    code VARCHAR(30) NOT NULL,
    description TEXT NOT NULL,
    specialty VARCHAR(100),

    -- Valorización
    professional_units DECIMAL(10,2),           -- Galenos / unidades
    operative_units DECIMAL(10,2),
    amount DECIMAL(12,2),                       -- Monto directo si aplica

    -- Reglas
    requires_authorization BOOLEAN DEFAULT false,
    requires_diagnosis BOOLEAN DEFAULT true,
    max_per_period INT,
    period_days INT,
    min_age INT,
    max_age INT,
    gender_restriction VARCHAR(10),

    coinsurance DECIMAL(12,2),                  -- Coseguro a cargo del paciente

    UNIQUE(nomenclator_id, code)
);

CREATE INDEX IF NOT EXISTS idx_nom_items_code ON nomenclator_items(nomenclator_id, code);
CREATE INDEX IF NOT EXISTS idx_nom_items_search ON nomenclator_items USING gin(to_tsvector('spanish', description));

-- ─── LOTES DE FACTURACIÓN ───────────────────────────────────

CREATE TABLE IF NOT EXISTS billing_batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    insurer_id UUID NOT NULL REFERENCES insurers(id),

    period_year INT NOT NULL,
    period_month INT NOT NULL,
    batch_number VARCHAR(40),

    status VARCHAR(30) DEFAULT 'draft',         -- draft | audited | submitted | accepted | rejected | paid

    total_items INT DEFAULT 0,
    total_amount DECIMAL(14,2) DEFAULT 0,
    accepted_amount DECIMAL(14,2),
    rejected_amount DECIMAL(14,2),

    submitted_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    export_url TEXT,
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_batches_org ON billing_batches(organization_id, period_year DESC, period_month DESC);
CREATE INDEX IF NOT EXISTS idx_batches_status ON billing_batches(status);

CREATE TABLE IF NOT EXISTS billing_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id UUID NOT NULL REFERENCES billing_batches(id) ON DELETE CASCADE,

    patient_id UUID REFERENCES patients(id),
    appointment_id UUID REFERENCES appointments(id),
    medical_record_id UUID REFERENCES medical_records(id),
    doctor_id UUID REFERENCES doctors(id),

    service_date DATE NOT NULL,
    nomenclator_code VARCHAR(30) NOT NULL,
    description TEXT,
    quantity INT DEFAULT 1,
    unit_amount DECIMAL(12,2),
    total_amount DECIMAL(12,2),

    affiliate_number VARCHAR(60),
    plan_code VARCHAR(50),
    diagnosis_code VARCHAR(10),
    authorization_code VARCHAR(60),

    -- Auditoría interna antes de presentar
    audit_status VARCHAR(20) DEFAULT 'pending', -- pending | ok | warning | blocked
    audit_notes TEXT[],

    -- Respuesta de la obra social
    is_accepted BOOLEAN,
    rejection_reason TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_items_batch ON billing_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_billing_items_audit ON billing_items(batch_id, audit_status);

-- ─── TRIGGERS ───────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_insurers_upd ON insurers;
CREATE TRIGGER trg_insurers_upd BEFORE UPDATE ON insurers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_connectors_upd ON connectors;
CREATE TRIGGER trg_connectors_upd BEFORE UPDATE ON connectors FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_provider_creds_upd ON provider_credentials;
CREATE TRIGGER trg_provider_creds_upd BEFORE UPDATE ON provider_credentials FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_batches_upd ON billing_batches;
CREATE TRIGGER trg_batches_upd BEFORE UPDATE ON billing_batches FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── LIMPIEZA DE CACHÉ ──────────────────────────────────────

CREATE OR REPLACE FUNCTION cleanup_affiliate_cache()
RETURNS void AS $$
BEGIN
    DELETE FROM affiliate_cache WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- ─── VISTA: cobertura del hub ───────────────────────────────

CREATE OR REPLACE VIEW v_hub_coverage AS
SELECT
    i.id AS insurer_id,
    i.name,
    i.short_name,
    i.rnos_code,
    i.province,
    i.affiliate_count,
    COUNT(c.id) FILTER (WHERE c.is_enabled) AS connector_count,
    BOOL_OR(c.can_validate_affiliate AND c.is_enabled) AS supports_validation,
    BOOL_OR(c.can_authorize_practice AND c.is_enabled) AS supports_authorization,
    BOOL_OR(c.can_submit_batch AND c.is_enabled) AS supports_batch,
    MIN(c.priority) FILTER (WHERE c.is_enabled) AS best_priority,
    (ARRAY_AGG(c.kind ORDER BY c.priority) FILTER (WHERE c.is_enabled))[1] AS primary_kind,
    (ARRAY_AGG(c.health ORDER BY c.priority) FILTER (WHERE c.is_enabled))[1] AS primary_health
FROM insurers i
LEFT JOIN connectors c ON c.insurer_id = i.id
WHERE i.is_active
GROUP BY i.id;
