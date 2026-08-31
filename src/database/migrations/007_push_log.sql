-- ============================================================
-- MediClick - Migration 007: Push notifications infrastructure
-- Tabla push_log + nuevos tipos de notificación
-- ============================================================

-- ─── Push log (auditoría de envíos) ────────────────────────

CREATE TABLE IF NOT EXISTS push_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_type VARCHAR(20) NOT NULL,
    user_id UUID NOT NULL,
    platform VARCHAR(10) NOT NULL,

    title VARCHAR(255) NOT NULL,
    body TEXT,

    status VARCHAR(10) NOT NULL DEFAULT 'sent',       -- sent | failed
    error TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_log_user
    ON push_log(user_type, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_push_log_status
    ON push_log(status, created_at DESC);

-- ─── Agregar nuevos tipos de notificación ──────────────────

DO $$
BEGIN
    -- Nuevos tipos para booking y turnos
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'new_booking' AND enumtypid = 'notification_type'::regtype) THEN
        ALTER TYPE notification_type ADD VALUE 'new_booking';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'booking_payment' AND enumtypid = 'notification_type'::regtype) THEN
        ALTER TYPE notification_type ADD VALUE 'booking_payment';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'appointment_overlap' AND enumtypid = 'notification_type'::regtype) THEN
        ALTER TYPE notification_type ADD VALUE 'appointment_overlap';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'waitlist_available' AND enumtypid = 'notification_type'::regtype) THEN
        ALTER TYPE notification_type ADD VALUE 'waitlist_available';
    END IF;
END
$$;
