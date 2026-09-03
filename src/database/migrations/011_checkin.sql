-- ============================================================
-- MediClick - Migration 011: Check-in de pacientes
-- La secretaria marca al paciente como "llegó"
-- ============================================================

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS checked_in_by VARCHAR(50); -- 'secretary', 'doctor', 'self'

-- Actualizar constraint de status para incluir checked_in
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_status_check 
  CHECK (status IN ('pending', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'));
