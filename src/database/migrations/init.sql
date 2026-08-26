-- ============================================================
-- MediClick - Schema PostgreSQL v2
-- Multi-consultorio / Centro médico + Médicos individuales
-- Un médico puede pertenecer a N organizaciones
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── ENUMS ──────────────────────────────────────────────────

CREATE TYPE org_type AS ENUM ('consultorio', 'centro_medico', 'clinica', 'hospital', 'individual');
CREATE TYPE org_role AS ENUM ('owner', 'admin', 'doctor', 'secretary');
CREATE TYPE appointment_status AS ENUM ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show');
CREATE TYPE prescription_status AS ENUM ('active', 'expired', 'cancelled');
CREATE TYPE message_type AS ENUM ('text', 'image', 'file', 'prescription', 'appointment');
CREATE TYPE gender_type AS ENUM ('male', 'female', 'other', 'not_specified');
CREATE TYPE blood_type AS ENUM ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown');
CREATE TYPE notification_type AS ENUM ('appointment_reminder', 'new_message', 'prescription_ready', 'appointment_confirmed', 'appointment_cancelled');
CREATE TYPE invite_status AS ENUM ('pending', 'accepted', 'rejected', 'expired');

-- ═══════════════════════════════════════════════════════════
-- CAPA 1: ORGANIZACIONES + DOCTORES (multi-tenant)
-- ═══════════════════════════════════════════════════════════

-- ─── ORGANIZATIONS (Consultorios / Centros médicos) ─────────
-- Un "individual" es un médico que trabaja solo (se autocrea)
-- Un "consultorio" o "centro_medico" puede tener N médicos

CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    name VARCHAR(200) NOT NULL,
    type org_type NOT NULL DEFAULT 'consultorio',
    
    -- Datos fiscales (Argentina)
    cuit VARCHAR(13),                                    -- XX-XXXXXXXX-X
    tax_name VARCHAR(200),                               -- Razón social
    
    -- Contacto
    phone VARCHAR(20),
    email VARCHAR(255),
    website VARCHAR(255),
    
    -- Ubicación
    address TEXT,
    city VARCHAR(100),
    province VARCHAR(100),
    postal_code VARCHAR(10),
    latitude DECIMAL(10, 7),
    longitude DECIMAL(10, 7),
    
    -- Branding
    logo_url TEXT,
    primary_color VARCHAR(7) DEFAULT '#2563EB',
    
    -- Config
    default_slot_duration INT DEFAULT 30,                -- Duración turno en minutos
    allow_online_booking BOOLEAN DEFAULT false,
    timezone VARCHAR(50) DEFAULT 'America/Argentina/Buenos_Aires',
    
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_org_type ON organizations(type);
CREATE INDEX idx_org_city ON organizations(city, province);

-- ─── DOCTORS ────────────────────────────────────────────────
-- El doctor existe independientemente de las organizaciones
-- Su cuenta es personal, se vincula a N consultorios

CREATE TABLE doctors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Auth
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    
    -- Datos personales
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    dni VARCHAR(20),
    
    -- Profesional
    medical_license VARCHAR(50) UNIQUE NOT NULL,         -- Matrícula
    medical_license_province VARCHAR(100),               -- Provincia de matrícula
    specialty VARCHAR(100) DEFAULT 'Clínica médica',
    secondary_specialties TEXT[],
    
    -- Perfil
    avatar_url TEXT,
    bio TEXT,
    
    -- Auth tokens
    refresh_token_hash VARCHAR(255),
    
    -- Estado
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    email_verified_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_doctors_email ON doctors(email);
CREATE INDEX idx_doctors_license ON doctors(medical_license);

-- ─── ORGANIZATION ↔ DOCTOR (muchos a muchos) ────────────────
-- Un doctor puede pertenecer a múltiples consultorios
-- Cada vínculo tiene un rol y permisos específicos

CREATE TABLE organization_doctors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    
    role org_role NOT NULL DEFAULT 'doctor',
    is_owner BOOLEAN DEFAULT false,                      -- El que creó la org
    
    -- Config específica para este consultorio
    consultation_fee DECIMAL(10, 2),                     -- Honorarios
    slot_duration_minutes INT,                           -- Override duración turno
    room_number VARCHAR(20),                             -- Consultorio/sala
    
    -- Disponibilidad en este consultorio
    is_active BOOLEAN DEFAULT true,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(organization_id, doctor_id)
);

CREATE INDEX idx_orgdoc_org ON organization_doctors(organization_id);
CREATE INDEX idx_orgdoc_doctor ON organization_doctors(doctor_id);
CREATE INDEX idx_orgdoc_active ON organization_doctors(organization_id, is_active) WHERE is_active = true;

-- ─── INVITATIONS (invitar doctor a un consultorio) ──────────

CREATE TABLE invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invited_by UUID NOT NULL REFERENCES doctors(id),
    
    invited_email VARCHAR(255) NOT NULL,
    invited_doctor_id UUID REFERENCES doctors(id),       -- NULL si no tiene cuenta aún
    
    role org_role NOT NULL DEFAULT 'doctor',
    status invite_status DEFAULT 'pending',
    
    token VARCHAR(100) UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invitations_email ON invitations(invited_email, status);
CREATE INDEX idx_invitations_token ON invitations(token);

-- ─── SECRETARIES (personal no-médico del consultorio) ───────

CREATE TABLE secretaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    
    -- Permisos granulares
    can_manage_appointments BOOLEAN DEFAULT true,
    can_view_medical_records BOOLEAN DEFAULT false,
    can_manage_patients BOOLEAN DEFAULT true,
    can_manage_billing BOOLEAN DEFAULT false,
    
    refresh_token_hash VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_secretaries_org ON secretaries(organization_id);
CREATE UNIQUE INDEX idx_secretaries_email_org ON secretaries(organization_id, email);

-- ═══════════════════════════════════════════════════════════
-- CAPA 2: PACIENTES (pertenecen a una organización)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE patients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Si el paciente fue referido por otro consultorio
    referred_from_org_id UUID REFERENCES organizations(id),
    
    -- Datos personales
    dni VARCHAR(20),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(20),
    date_of_birth DATE,
    gender gender_type DEFAULT 'not_specified',
    blood_type blood_type DEFAULT 'unknown',
    
    -- Ubicación
    address TEXT,
    city VARCHAR(100),
    province VARCHAR(100),
    
    -- Contacto de emergencia
    emergency_contact_name VARCHAR(200),
    emergency_contact_phone VARCHAR(20),
    
    -- Obra social / prepaga
    insurance_provider VARCHAR(200),
    insurance_number VARCHAR(50),
    insurance_plan VARCHAR(100),
    
    -- Médico principal asignado (opcional)
    primary_doctor_id UUID REFERENCES doctors(id),
    
    -- Datos clínicos rápidos
    allergies TEXT[],
    chronic_conditions TEXT[],
    current_medications TEXT[],
    
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    
    -- Sync
    sync_status VARCHAR(20) DEFAULT 'synced',
    last_synced_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_patients_org ON patients(organization_id);
CREATE INDEX idx_patients_dni ON patients(organization_id, dni);
CREATE INDEX idx_patients_name ON patients(organization_id, last_name, first_name);
CREATE INDEX idx_patients_doctor ON patients(primary_doctor_id);

-- ═══════════════════════════════════════════════════════════
-- CAPA 3: AGENDA Y TURNOS
-- ═══════════════════════════════════════════════════════════

-- ─── HORARIOS DEL DOCTOR POR ORGANIZACIÓN ───────────────────
-- Un doctor puede tener horarios distintos en cada consultorio

CREATE TABLE doctor_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_doctor_id UUID NOT NULL REFERENCES organization_doctors(id) ON DELETE CASCADE,
    
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    slot_duration_minutes INT DEFAULT 30,
    max_patients_per_slot INT DEFAULT 1,
    
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_schedule_orgdoc ON doctor_schedules(org_doctor_id);
CREATE UNIQUE INDEX idx_schedule_unique ON doctor_schedules(org_doctor_id, day_of_week) WHERE is_active = true;

-- ─── EXCEPCIONES DE HORARIO ─────────────────────────────────

CREATE TABLE schedule_exceptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_doctor_id UUID NOT NULL REFERENCES organization_doctors(id) ON DELETE CASCADE,
    
    date DATE NOT NULL,
    is_available BOOLEAN DEFAULT false,
    start_time TIME,
    end_time TIME,
    reason VARCHAR(255),
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_exceptions_orgdoc ON schedule_exceptions(org_doctor_id, date);

-- ─── APPOINTMENTS (vinculado a org_doctor, no solo doctor) ──

CREATE TABLE appointments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    org_doctor_id UUID NOT NULL REFERENCES organization_doctors(id),
    patient_id UUID NOT NULL REFERENCES patients(id),
    
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    
    status appointment_status DEFAULT 'pending',
    reason TEXT,
    notes TEXT,
    
    is_first_visit BOOLEAN DEFAULT false,
    is_online BOOLEAN DEFAULT false,                     -- Teleconsulta
    room_number VARCHAR(20),
    
    -- Quién creó el turno
    created_by_type VARCHAR(20) DEFAULT 'doctor',        -- doctor, secretary, patient
    created_by_id UUID,
    
    reminder_sent BOOLEAN DEFAULT false,
    reminder_sent_at TIMESTAMPTZ,
    
    cancelled_at TIMESTAMPTZ,
    cancelled_by VARCHAR(20),
    cancelled_reason TEXT,
    
    -- Sync
    sync_status VARCHAR(20) DEFAULT 'synced',
    last_synced_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_appt_org_date ON appointments(organization_id, date);
CREATE INDEX idx_appt_orgdoc_date ON appointments(org_doctor_id, date);
CREATE INDEX idx_appt_patient ON appointments(patient_id);
CREATE INDEX idx_appt_status ON appointments(status);

-- ═══════════════════════════════════════════════════════════
-- CAPA 4: HISTORIA CLÍNICA
-- ═══════════════════════════════════════════════════════════

CREATE TABLE medical_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES doctors(id),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    appointment_id UUID REFERENCES appointments(id),
    
    date TIMESTAMPTZ DEFAULT NOW(),
    
    chief_complaint TEXT NOT NULL,
    present_illness TEXT,
    
    -- Signos vitales
    vital_signs JSONB DEFAULT '{}',
    physical_exam TEXT,
    
    -- Diagnóstico
    diagnosis TEXT NOT NULL,
    diagnosis_code VARCHAR(10),                          -- CIE-10
    secondary_diagnoses JSONB DEFAULT '[]',
    
    treatment_plan TEXT,
    
    lab_orders TEXT[],
    imaging_orders TEXT[],
    referrals TEXT[],                                    -- Derivaciones
    
    private_notes TEXT,
    
    -- Sync
    sync_status VARCHAR(20) DEFAULT 'synced',
    last_synced_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_records_patient ON medical_records(patient_id, date DESC);
CREATE INDEX idx_records_org ON medical_records(organization_id);
CREATE INDEX idx_records_doctor ON medical_records(doctor_id);

-- ═══════════════════════════════════════════════════════════
-- CAPA 5: RECETAS DIGITALES
-- ═══════════════════════════════════════════════════════════

CREATE TABLE prescriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doctor_id UUID NOT NULL REFERENCES doctors(id),
    patient_id UUID NOT NULL REFERENCES patients(id),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    medical_record_id UUID REFERENCES medical_records(id),
    
    status prescription_status DEFAULT 'active',
    
    diagnosis TEXT NOT NULL,
    diagnosis_code VARCHAR(10),
    
    issued_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    
    -- Firma digital
    digital_signature TEXT,
    
    -- Código de verificación público
    verification_code VARCHAR(20) UNIQUE DEFAULT UPPER(SUBSTRING(md5(random()::text) FROM 1 FOR 8)),
    
    notes TEXT,
    
    -- Sync
    sync_status VARCHAR(20) DEFAULT 'synced',
    last_synced_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rx_doctor ON prescriptions(doctor_id);
CREATE INDEX idx_rx_patient ON prescriptions(patient_id);
CREATE INDEX idx_rx_org ON prescriptions(organization_id);
CREATE INDEX idx_rx_verification ON prescriptions(verification_code);

CREATE TABLE prescription_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
    
    medication_name VARCHAR(255) NOT NULL,
    dosage VARCHAR(100) NOT NULL,
    frequency VARCHAR(200) NOT NULL,
    duration VARCHAR(100),
    quantity INT,
    instructions TEXT,
    
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rx_items ON prescription_items(prescription_id);

-- ═══════════════════════════════════════════════════════════
-- CAPA 6: CHAT / MENSAJERÍA
-- ═══════════════════════════════════════════════════════════

CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    doctor_id UUID NOT NULL REFERENCES doctors(id),
    patient_id UUID NOT NULL REFERENCES patients(id),
    
    last_message_text TEXT,
    last_message_at TIMESTAMPTZ,
    
    doctor_unread_count INT DEFAULT 0,
    patient_unread_count INT DEFAULT 0,
    
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_conv_unique ON conversations(organization_id, doctor_id, patient_id);
CREATE INDEX idx_conv_doctor ON conversations(doctor_id, last_message_at DESC);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    
    sender_type VARCHAR(10) NOT NULL CHECK (sender_type IN ('doctor', 'patient')),
    sender_id UUID NOT NULL,
    
    message_type message_type DEFAULT 'text',
    content TEXT NOT NULL,
    
    attachment_url TEXT,
    attachment_name VARCHAR(255),
    
    prescription_id UUID REFERENCES prescriptions(id),
    appointment_id UUID REFERENCES appointments(id),
    
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMPTZ,
    
    -- Sync
    sync_status VARCHAR(20) DEFAULT 'synced',
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_msg_conv ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_msg_unread ON messages(conversation_id, is_read) WHERE is_read = false;

-- ═══════════════════════════════════════════════════════════
-- CAPA 7: NOTIFICACIONES + PUSH + AUDIT
-- ═══════════════════════════════════════════════════════════

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id),
    
    recipient_type VARCHAR(20) NOT NULL,                 -- doctor, patient, secretary
    recipient_id UUID NOT NULL,
    
    type notification_type NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    data JSONB DEFAULT '{}',
    
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMPTZ,
    push_sent BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notif_recipient ON notifications(recipient_type, recipient_id, created_at DESC);

CREATE TABLE push_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_type VARCHAR(20) NOT NULL,
    user_id UUID NOT NULL,
    platform VARCHAR(10) NOT NULL CHECK (platform IN ('ios', 'android')),
    token TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_push_unique ON push_tokens(user_type, user_id, platform, token);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id),
    doctor_id UUID REFERENCES doctors(id),
    
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    details JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_org ON audit_logs(organization_id, created_at DESC);
CREATE INDEX idx_audit_doctor ON audit_logs(doctor_id, created_at DESC);

-- ─── PATIENT AUTH ───────────────────────────────────────────

CREATE TABLE patient_auth (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID UNIQUE NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    phone VARCHAR(20) NOT NULL,
    pin_hash VARCHAR(255),
    otp_code VARCHAR(6),
    otp_expires_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    refresh_token_hash VARCHAR(255),
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_patient_auth_phone ON patient_auth(phone);

-- ═══════════════════════════════════════════════════════════
-- FUNCIONES + TRIGGERS + VISTAS
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orgs_upd BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_doctors_upd BEFORE UPDATE ON doctors FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_orgdoc_upd BEFORE UPDATE ON organization_doctors FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_patients_upd BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_records_upd BEFORE UPDATE ON medical_records FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_appt_upd BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_rx_upd BEFORE UPDATE ON prescriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_conv_upd BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Vencimiento automático de recetas
CREATE OR REPLACE FUNCTION expire_prescriptions()
RETURNS void AS $$
BEGIN
    UPDATE prescriptions 
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'active' AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- ─── VISTA: Agenda del día con contexto de organización ─────

CREATE VIEW v_daily_agenda AS
SELECT 
    a.id,
    a.organization_id,
    a.org_doctor_id,
    o.name AS org_name,
    o.type AS org_type,
    d.id AS doctor_id,
    d.first_name || ' ' || d.last_name AS doctor_name,
    d.specialty AS doctor_specialty,
    a.date,
    a.start_time,
    a.end_time,
    a.status,
    a.reason,
    a.is_first_visit,
    a.is_online,
    a.room_number,
    p.id AS patient_id,
    p.first_name || ' ' || p.last_name AS patient_name,
    p.phone AS patient_phone,
    p.insurance_provider,
    p.insurance_plan
FROM appointments a
JOIN organization_doctors od ON od.id = a.org_doctor_id
JOIN organizations o ON o.id = a.organization_id
JOIN doctors d ON d.id = od.doctor_id
JOIN patients p ON p.id = a.patient_id
WHERE a.status NOT IN ('cancelled')
ORDER BY a.date, a.start_time;

-- ─── VISTA: Doctores de una organización ────────────────────

CREATE VIEW v_org_doctors AS
SELECT 
    od.id AS org_doctor_id,
    od.organization_id,
    od.role,
    od.is_owner,
    od.consultation_fee,
    od.slot_duration_minutes,
    od.room_number,
    od.is_active,
    d.id AS doctor_id,
    d.first_name,
    d.last_name,
    d.first_name || ' ' || d.last_name AS full_name,
    d.medical_license,
    d.specialty,
    d.avatar_url,
    d.phone,
    d.email,
    o.name AS org_name,
    o.type AS org_type
FROM organization_doctors od
JOIN doctors d ON d.id = od.doctor_id
JOIN organizations o ON o.id = od.organization_id;

-- ─── VISTA: Organizaciones de un doctor ─────────────────────

CREATE VIEW v_doctor_orgs AS
SELECT 
    od.id AS org_doctor_id,
    od.doctor_id,
    od.role,
    od.is_owner,
    od.is_active,
    o.id AS org_id,
    o.name AS org_name,
    o.type AS org_type,
    o.address AS org_address,
    o.city AS org_city,
    o.phone AS org_phone,
    o.logo_url AS org_logo,
    (SELECT COUNT(*) FROM patients p WHERE p.organization_id = o.id AND p.is_active) AS patient_count,
    (SELECT COUNT(*) FROM organization_doctors od2 WHERE od2.organization_id = o.id AND od2.is_active) AS doctor_count
FROM organization_doctors od
JOIN organizations o ON o.id = od.organization_id
WHERE od.is_active = true;

-- ═══════════════════════════════════════════════════════════
-- OAUTH ACCOUNTS (Google / Apple Sign-In)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE oauth_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    
    provider VARCHAR(20) NOT NULL,              -- 'google' | 'apple'
    provider_id VARCHAR(255) NOT NULL,          -- ID único del proveedor
    email VARCHAR(255),
    avatar_url TEXT,
    
    last_login_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(provider, provider_id)
);

CREATE INDEX idx_oauth_doctor ON oauth_accounts(doctor_id);
CREATE INDEX idx_oauth_provider ON oauth_accounts(provider, provider_id);

-- ═══════════════════════════════════════════════════════════
-- SISTEMA DE RESERVAS PÚBLICAS (link para pacientes)
-- ═══════════════════════════════════════════════════════════

CREATE TYPE booking_mode AS ENUM (
    'open',              -- Reserva libre, sin requisitos
    'approval',          -- Requiere que el médico apruebe
    'deposit',           -- Requiere seña
    'deposit_approval'   -- Seña + aprobación
);

CREATE TYPE payment_method AS ENUM ('transfer', 'cash', 'both');
CREATE TYPE payment_status AS ENUM ('pending', 'proof_uploaded', 'confirmed', 'rejected', 'refunded');
CREATE TYPE booking_status AS ENUM (
    'pending_payment',   -- Esperando seña
    'pending_approval',  -- Esperando aprobación del médico
    'confirmed',         -- Confirmado
    'rejected',          -- Rechazado por el médico
    'cancelled',         -- Cancelado por el paciente
    'expired'            -- Venció el tiempo para pagar
);

-- ─── CONFIGURACIÓN DE RESERVAS POR MÉDICO/ORG ──────────────

CREATE TABLE booking_settings (
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

CREATE INDEX idx_booking_settings_slug ON booking_settings(public_slug) WHERE is_enabled = true;
CREATE INDEX idx_booking_settings_orgdoc ON booking_settings(org_doctor_id);

-- ─── SOLICITUDES DE RESERVA (desde el link público) ────────

CREATE TABLE booking_requests (
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

CREATE INDEX idx_booking_req_orgdoc ON booking_requests(org_doctor_id, status);
CREATE INDEX idx_booking_req_date ON booking_requests(requested_date);
CREATE INDEX idx_booking_req_token ON booking_requests(confirmation_token);
CREATE INDEX idx_booking_req_phone ON booking_requests(phone);
CREATE INDEX idx_booking_req_pending ON booking_requests(org_doctor_id) WHERE status IN ('pending_payment', 'pending_approval');

-- ─── PAGOS / SEÑAS ──────────────────────────────────────────

CREATE TABLE payments (
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

CREATE INDEX idx_payments_org ON payments(organization_id, created_at DESC);
CREATE INDEX idx_payments_booking ON payments(booking_request_id);
CREATE INDEX idx_payments_status ON payments(status);

-- ─── SLOTS BLOQUEADOS TEMPORALMENTE ────────────────────────
-- Cuando alguien está reservando, se bloquea el slot X minutos

CREATE TABLE slot_holds (
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

CREATE INDEX idx_slot_holds ON slot_holds(org_doctor_id, date, start_time);
CREATE INDEX idx_slot_holds_expiry ON slot_holds(expires_at);

-- ─── TRIGGERS ───────────────────────────────────────────────

CREATE TRIGGER trg_booking_settings_upd BEFORE UPDATE ON booking_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_booking_req_upd BEFORE UPDATE ON booking_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
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

CREATE VIEW v_public_doctor_profile AS
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
