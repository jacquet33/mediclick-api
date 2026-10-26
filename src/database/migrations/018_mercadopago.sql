-- ============================================================
-- MediClick - Migration 018: Mercado Pago Subscriptions
-- Agrega soporte de cobro por Mercado Pago (ARS)
-- para suscripciones web (no App Store / Play Store)
-- ============================================================

-- Agregar 'mercadopago' al enum de store_type
ALTER TYPE store_type ADD VALUE IF NOT EXISTS 'mercadopago';

-- ─── TABLA DE PLANES MP ───────────────────────────────────
-- Mapea planes internos a preapproval_plan de Mercado Pago

CREATE TABLE IF NOT EXISTS mp_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    internal_plan VARCHAR(30) NOT NULL UNIQUE,         -- 'pro', 'centro'
    mp_plan_id VARCHAR(100),                           -- ID del preapproval_plan en MP
    name VARCHAR(100) NOT NULL,
    description TEXT,
    amount DECIMAL(10, 2) NOT NULL,                    -- Precio en ARS
    currency VARCHAR(3) DEFAULT 'ARS',
    frequency INT DEFAULT 1,                           -- Cada cuántos meses
    frequency_type VARCHAR(20) DEFAULT 'months',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE mp_plans IS 'Planes de Mercado Pago con precios en ARS';

-- Insertar planes iniciales
INSERT INTO mp_plans (internal_plan, name, description, amount) VALUES
    ('pro', 'MediClick Profesional', 'Turnos ilimitados, agenda completa, recordatorios automáticos', 9990.00),
    ('centro', 'MediClick Centro Médico', 'Multi-consultorio, roles y permisos, reportes avanzados', 29990.00)
ON CONFLICT (internal_plan) DO NOTHING;

-- ─── PAGOS DE MP ──────────────────────────────────────────
-- Registro de cada pago recibido via webhook de Mercado Pago

CREATE TABLE IF NOT EXISTS mp_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscription_id UUID REFERENCES subscriptions(id),
    doctor_id UUID NOT NULL REFERENCES doctors(id),

    -- Datos de MP
    mp_payment_id VARCHAR(100) NOT NULL UNIQUE,
    mp_preapproval_id VARCHAR(100),                    -- ID de suscripción en MP
    mp_status VARCHAR(30) NOT NULL,                    -- approved, pending, rejected, etc.
    mp_status_detail VARCHAR(100),

    -- Monto
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'ARS',

    -- Fechas
    date_approved TIMESTAMPTZ,
    date_created TIMESTAMPTZ,

    -- Raw data para debugging
    raw_data JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mp_payments_doctor ON mp_payments(doctor_id, created_at DESC);
CREATE INDEX idx_mp_payments_sub ON mp_payments(subscription_id);
CREATE INDEX idx_mp_payments_mp_id ON mp_payments(mp_payment_id);
CREATE INDEX idx_mp_payments_preapproval ON mp_payments(mp_preapproval_id);

COMMENT ON TABLE mp_payments IS 'Historial de pagos de Mercado Pago';

-- ─── ACTUALIZAR VISTA ─────────────────────────────────────
-- Recrear la vista para incluir mercadopago como store válido

CREATE OR REPLACE VIEW v_doctor_subscription AS
SELECT
    d.id AS doctor_id,
    d.email,
    COALESCE(s.plan, 'free') AS plan,
    COALESCE(s.status, 'active') AS subscription_status,
    s.id AS subscription_id,
    s.store,
    s.current_period_start,
    s.current_period_end,
    s.cancelled_at,
    s.grace_period_end,
    s.is_trial,
    s.trial_end,
    CASE
        WHEN s.plan = 'pro' AND s.status IN ('active', 'grace_period') THEN true
        ELSE false
    END AS is_pro,
    CASE
        WHEN s.plan = 'pro' AND s.status IN ('active', 'grace_period') THEN -1
        ELSE 50
    END AS max_appointments_per_month,
    CASE
        WHEN s.plan = 'pro' AND s.status IN ('active', 'grace_period') THEN -1
        ELSE 1
    END AS max_organizations
FROM doctors d
LEFT JOIN subscriptions s ON s.doctor_id = d.id
    AND s.status IN ('active', 'grace_period', 'billing_retry')
WHERE d.is_active = true;
