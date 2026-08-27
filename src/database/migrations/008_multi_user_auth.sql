-- ============================================================
-- MediClick - Migration 008: Auth multi-usuario
-- Login unificado para médicos, pacientes y staff/admin
-- ============================================================

-- ─── Auth de pacientes ─────────────────────────────────────
CREATE TABLE patient_auth (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    phone VARCHAR(30),
    is_verified BOOLEAN DEFAULT false,
    verification_code VARCHAR(10),
    refresh_token_hash VARCHAR(255),
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_patient_auth_patient UNIQUE (patient_id)
);

CREATE INDEX idx_patient_auth_email ON patient_auth(email);
CREATE INDEX idx_patient_auth_patient ON patient_auth(patient_id);

CREATE TRIGGER trg_patient_auth_upd
    BEFORE UPDATE ON patient_auth
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Agregar auth fields a staff (ya tiene email y password_hash) ──
-- Solo necesitamos refresh_token_hash si no existe
ALTER TABLE staff ADD COLUMN IF NOT EXISTS refresh_token_hash VARCHAR(255);

-- ─── Vista unificada de login ──────────────────────────────
CREATE OR REPLACE VIEW v_login_lookup AS
-- Médicos
SELECT 
    d.id AS user_id,
    d.email,
    d.password_hash,
    'doctor' AS user_type,
    d.first_name,
    d.last_name,
    d.first_name || ' ' || d.last_name AS full_name,
    d.specialty,
    d.medical_license,
    d.avatar_url,
    d.is_active,
    NULL::UUID AS patient_id,
    NULL::UUID AS staff_id
FROM doctors d
WHERE d.is_active = true

UNION ALL

-- Pacientes
SELECT
    pa.id AS user_id,
    pa.email,
    pa.password_hash,
    'patient' AS user_type,
    p.first_name,
    p.last_name,
    p.first_name || ' ' || p.last_name AS full_name,
    NULL AS specialty,
    NULL AS medical_license,
    NULL AS avatar_url,
    true AS is_active,
    p.id AS patient_id,
    NULL::UUID AS staff_id
FROM patient_auth pa
JOIN patients p ON p.id = pa.patient_id

UNION ALL

-- Staff (admin, secretaria, enfermero, etc.)
SELECT
    s.id AS user_id,
    s.email,
    s.password_hash,
    'staff' AS user_type,
    s.first_name,
    s.last_name,
    s.first_name || ' ' || s.last_name AS full_name,
    s.specialty,
    s.license_number AS medical_license,
    s.avatar_url,
    s.is_active,
    NULL::UUID AS patient_id,
    s.id AS staff_id
FROM staff s
WHERE s.is_active = true;

RAISE NOTICE '✅ Migración 008 completa:';
RAISE NOTICE '   • Tabla patient_auth creada';
RAISE NOTICE '   • Vista v_login_lookup unificada (doctors + patients + staff)';
