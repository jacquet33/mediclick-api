-- ============================================================
-- MediClick - Migration 009: Push Notifications
-- Device tokens + notification log
-- ============================================================

CREATE TABLE device_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Quién (uno de los tres)
    doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE,
    patient_auth_id UUID REFERENCES patient_auth(id) ON DELETE CASCADE,
    staff_id UUID REFERENCES staff(id) ON DELETE CASCADE,
    
    -- Token
    token TEXT NOT NULL,
    platform VARCHAR(10) NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    
    -- Metadata
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

CREATE INDEX idx_device_tokens_doctor ON device_tokens(doctor_id) WHERE doctor_id IS NOT NULL AND is_active = true;
CREATE INDEX idx_device_tokens_patient ON device_tokens(patient_auth_id) WHERE patient_auth_id IS NOT NULL AND is_active = true;
CREATE INDEX idx_device_tokens_staff ON device_tokens(staff_id) WHERE staff_id IS NOT NULL AND is_active = true;

-- Log de notificaciones enviadas
CREATE TABLE push_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_token_id UUID REFERENCES device_tokens(id) ON DELETE SET NULL,
    recipient_type VARCHAR(10) NOT NULL,  -- doctor, patient, staff
    recipient_id UUID NOT NULL,
    
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    category VARCHAR(50),                 -- appointment_reminder, new_message, slot_released, etc.
    data JSONB,
    
    status VARCHAR(20) DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'failed', 'expired')),
    error_message TEXT,
    
    sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_push_log_recipient ON push_log(recipient_type, recipient_id, sent_at DESC);

RAISE NOTICE '✅ Migración 009: device_tokens + push_log creadas';
