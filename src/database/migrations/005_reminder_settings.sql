-- ============================================================
-- MediClick - Migration 005: Reminder/Notification Preferences
-- Per-doctor configurable reminder settings
-- ============================================================

CREATE TABLE doctor_reminder_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,

    -- ─── Recordatorio de turnos ────────────────────────────
    appointment_reminder_enabled   BOOLEAN DEFAULT true,
    appointment_reminder_minutes   INT[]   DEFAULT '{30}',     -- puede tener varios: {15,30,60}
    appointment_reminder_push      BOOLEAN DEFAULT true,
    appointment_reminder_email     BOOLEAN DEFAULT false,

    -- ─── Resumen diario ────────────────────────────────────
    daily_summary_enabled          BOOLEAN DEFAULT false,
    daily_summary_time             TIME    DEFAULT '08:00',    -- hora local (AR)
    daily_summary_days             INT[]   DEFAULT '{1,2,3,4,5}', -- 0=dom..6=sáb

    -- ─── Mensajes nuevos ───────────────────────────────────
    new_message_enabled            BOOLEAN DEFAULT true,
    new_message_push               BOOLEAN DEFAULT true,
    new_message_sound              BOOLEAN DEFAULT true,

    -- ─── Recetas por vencer ────────────────────────────────
    prescription_expiry_enabled    BOOLEAN DEFAULT true,
    prescription_expiry_days       INT     DEFAULT 7,          -- días antes de vencimiento

    -- ─── Cancelaciones ─────────────────────────────────────
    cancellation_alert_enabled     BOOLEAN DEFAULT true,
    no_show_alert_enabled          BOOLEAN DEFAULT true,

    -- ─── Horario silencioso ────────────────────────────────
    quiet_hours_enabled            BOOLEAN DEFAULT false,
    quiet_hours_start              TIME    DEFAULT '22:00',
    quiet_hours_end                TIME    DEFAULT '07:00',

    -- ─── Conflictos entre consultorios ─────────────────────
    cross_org_conflict_enabled     BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_doctor_reminder_settings UNIQUE (doctor_id)
);

CREATE INDEX idx_reminder_settings_doctor ON doctor_reminder_settings(doctor_id);

-- Trigger para updated_at
CREATE TRIGGER trg_reminder_settings_upd
    BEFORE UPDATE ON doctor_reminder_settings
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ─── Auto-crear settings para doctores existentes ──────────
INSERT INTO doctor_reminder_settings (doctor_id)
SELECT id FROM doctors
ON CONFLICT DO NOTHING;
