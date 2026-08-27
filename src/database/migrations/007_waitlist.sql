-- ============================================================
-- MediClick - Migration 007: Lista de espera / Alerta de turno libre
-- Notifica cuando se libera un turno en un día específico
-- ============================================================

CREATE TABLE waitlist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    org_doctor_id UUID NOT NULL REFERENCES organization_doctors(id) ON DELETE CASCADE,
    
    -- Quién espera
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,    -- paciente existente
    contact_name VARCHAR(200),                                     -- o datos sueltos
    contact_phone VARCHAR(30),
    contact_email VARCHAR(255),
    
    -- Qué espera
    desired_date DATE NOT NULL,
    preferred_start_time TIME,                                     -- NULL = cualquier hora
    preferred_end_time TIME,
    reason TEXT,
    
    -- Estado
    status VARCHAR(20) DEFAULT 'waiting'
        CHECK (status IN ('waiting', 'notified', 'booked', 'expired', 'cancelled')),
    
    -- Seguimiento
    notified_at TIMESTAMPTZ,
    notified_slot_time TIME,                                       -- qué horario se liberó
    booked_appointment_id UUID REFERENCES appointments(id),
    
    -- Prioridad (menor = más urgente)
    priority SMALLINT DEFAULT 50,
    notes TEXT,
    
    -- Notificación
    notify_push BOOLEAN DEFAULT true,
    notify_sms BOOLEAN DEFAULT false,
    notify_email BOOLEAN DEFAULT false,
    
    -- Auto-expirar después de la fecha
    expires_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_waitlist_org ON waitlist(organization_id);
CREATE INDEX idx_waitlist_doctor_date ON waitlist(org_doctor_id, desired_date) WHERE status = 'waiting';
CREATE INDEX idx_waitlist_patient ON waitlist(patient_id) WHERE patient_id IS NOT NULL;
CREATE INDEX idx_waitlist_status ON waitlist(status, desired_date);

CREATE TRIGGER trg_waitlist_upd
    BEFORE UPDATE ON waitlist
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ─── Tabla de notificaciones de slots liberados ────────────
CREATE TABLE slot_release_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    waitlist_id UUID NOT NULL REFERENCES waitlist(id) ON DELETE CASCADE,
    org_doctor_id UUID NOT NULL,
    released_date DATE NOT NULL,
    released_start_time TIME NOT NULL,
    released_end_time TIME NOT NULL,
    
    -- De qué turno viene la liberación
    cancelled_appointment_id UUID REFERENCES appointments(id),
    
    -- Estado
    notification_sent BOOLEAN DEFAULT false,
    sent_at TIMESTAMPTZ,
    response VARCHAR(20) CHECK (response IN ('accepted', 'declined', 'expired')),
    responded_at TIMESTAMPTZ,
    
    -- El slot se reserva temporalmente por N minutos
    hold_until TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_slot_release_waitlist ON slot_release_notifications(waitlist_id);

RAISE NOTICE '✅ Migración 007: tablas waitlist + slot_release_notifications creadas';
