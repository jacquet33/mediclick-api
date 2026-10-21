-- ============================================================
-- MediClick - Migration 010: Fix appointment_status enum + ensure push tables
-- ============================================================

-- Agregar valores faltantes al enum appointment_status
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'pending_payment' AND enumtypid = 'appointment_status'::regtype) THEN
        ALTER TYPE appointment_status ADD VALUE 'pending_payment';
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'pending_approval' AND enumtypid = 'appointment_status'::regtype) THEN
        ALTER TYPE appointment_status ADD VALUE 'pending_approval';
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'checked_in' AND enumtypid = 'appointment_status'::regtype) THEN
        ALTER TYPE appointment_status ADD VALUE 'checked_in';
    END IF;
END$$;

-- Crear tabla device_tokens si no existe
CREATE TABLE IF NOT EXISTS device_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE,
    patient_auth_id UUID REFERENCES patient_auth(id) ON DELETE CASCADE,
    staff_id UUID REFERENCES staff(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    platform VARCHAR(10) NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    device_name VARCHAR(100),
    app_version VARCHAR(20),
    os_version VARCHAR(20),
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_device_token UNIQUE (token),
    CONSTRAINT chk_device_owner CHECK (
        (doctor_id IS NOT NULL)::int + (patient_auth_id IS NOT NULL)::int + (staff_id IS NOT NULL)::int = 1
    )
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_doctor ON device_tokens(doctor_id) WHERE doctor_id IS NOT NULL AND is_active = true;
CREATE INDEX IF NOT EXISTS idx_device_tokens_patient ON device_tokens(patient_auth_id) WHERE patient_auth_id IS NOT NULL AND is_active = true;
CREATE INDEX IF NOT EXISTS idx_device_tokens_staff ON device_tokens(staff_id) WHERE staff_id IS NOT NULL AND is_active = true;

-- Crear tabla push_log si no existe
CREATE TABLE IF NOT EXISTS push_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_token_id UUID REFERENCES device_tokens(id) ON DELETE SET NULL,
    recipient_type VARCHAR(10) NOT NULL,
    recipient_id UUID NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    category VARCHAR(50),
    data JSONB,
    status VARCHAR(20) DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'failed', 'expired')),
    error_message TEXT,
    sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_log_recipient ON push_log(recipient_type, recipient_id, sent_at DESC);
