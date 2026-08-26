-- ============================================================
-- MediClick - Migration 006: Subscriptions
-- Modelo de suscripción por doctor: Free / Pro ($2.99 USD/mes)
-- Soporta Apple App Store + Google Play Store
-- ============================================================

-- ─── ENUMS ──────────────────────────────────────────────────

CREATE TYPE subscription_plan   AS ENUM ('free', 'pro');
CREATE TYPE subscription_status AS ENUM ('active', 'expired', 'cancelled', 'grace_period', 'billing_retry');
CREATE TYPE store_type          AS ENUM ('apple', 'google', 'manual');

-- ─── SUBSCRIPTIONS ─────────────────────────────────────────
-- Una sola suscripción activa por doctor.
-- Cuando el doctor se registra, queda en plan "free" automáticamente.

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,

    -- Plan
    plan subscription_plan NOT NULL DEFAULT 'free',
    status subscription_status NOT NULL DEFAULT 'active',

    -- Store (Apple / Google)
    store store_type,
    store_product_id VARCHAR(100),                -- com.mediclick.pro.monthly
    store_transaction_id VARCHAR(200) UNIQUE,      -- ID único de la transacción
    store_original_transaction_id VARCHAR(200),     -- ID original (para renewals)

    -- Períodos
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    grace_period_end TIMESTAMPTZ,

    -- Precio pagado (para analytics)
    price_usd DECIMAL(6, 2),
    currency VARCHAR(3) DEFAULT 'USD',

    -- Trial (si se ofrece en el futuro)
    is_trial BOOLEAN DEFAULT false,
    trial_end TIMESTAMPTZ,

    -- Metadata
    raw_receipt JSONB,                             -- Último recibo procesado
    last_verified_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Un solo plan activo por doctor
CREATE UNIQUE INDEX idx_subscriptions_doctor_active
    ON subscriptions(doctor_id)
    WHERE status IN ('active', 'grace_period', 'billing_retry');

CREATE INDEX idx_subscriptions_doctor ON subscriptions(doctor_id);
CREATE INDEX idx_subscriptions_store_txn ON subscriptions(store_transaction_id);
CREATE INDEX idx_subscriptions_original_txn ON subscriptions(store_original_transaction_id);
CREATE INDEX idx_subscriptions_expiring ON subscriptions(current_period_end)
    WHERE status = 'active' AND plan = 'pro';

-- ─── SUBSCRIPTION EVENTS (auditoría) ───────────────────────
-- Cada cambio de estado se registra para trazabilidad y analytics.

CREATE TABLE subscription_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES doctors(id),

    event_type VARCHAR(40) NOT NULL,               -- subscribe | renew | cancel | expire | grace_period | billing_retry | refund | upgrade | downgrade
    from_plan subscription_plan,
    to_plan subscription_plan,
    from_status subscription_status,
    to_status subscription_status,

    -- Datos del store
    store store_type,
    store_transaction_id VARCHAR(200),
    amount_usd DECIMAL(6, 2),

    -- Contexto
    reason TEXT,                                    -- user_cancelled | billing_failed | refund | admin_action
    metadata JSONB DEFAULT '{}',

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sub_events_sub ON subscription_events(subscription_id, created_at DESC);
CREATE INDEX idx_sub_events_doctor ON subscription_events(doctor_id, created_at DESC);
CREATE INDEX idx_sub_events_type ON subscription_events(event_type, created_at DESC);

-- ─── FEATURE LIMITS (para tier free) ───────────────────────
-- Contadores mensuales para controlar límites del plan free.

CREATE TABLE feature_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,

    period_year INT NOT NULL,
    period_month INT NOT NULL,

    appointments_count INT DEFAULT 0,              -- Límite free: 50/mes
    organizations_count INT DEFAULT 0,             -- Límite free: 1

    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(doctor_id, period_year, period_month)
);

CREATE INDEX idx_feature_usage_doctor ON feature_usage(doctor_id, period_year DESC, period_month DESC);

-- ─── VISTA: estado de suscripción del doctor ───────────────
-- Usado por el guard y la app para saber qué plan tiene.

CREATE VIEW v_doctor_subscription AS
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
    -- Límites según plan
    CASE
        WHEN s.plan = 'pro' AND s.status IN ('active', 'grace_period') THEN -1  -- ilimitado
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

-- ─── TRIGGER ───────────────────────────────────────────────

CREATE TRIGGER trg_subscriptions_upd
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── CREAR SUSCRIPCIÓN FREE PARA DOCTORES EXISTENTES ───────

INSERT INTO subscriptions (doctor_id, plan, status)
SELECT id, 'free', 'active' FROM doctors
WHERE is_active = true
ON CONFLICT DO NOTHING;
