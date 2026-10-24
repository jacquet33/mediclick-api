-- Migration 014: Add Historia Clínica extended fields to medical_records
-- New text fields for complete clinical history format

ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS record_type VARCHAR(50) DEFAULT 'consulta';
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS personal_history TEXT;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS family_history TEXT;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS current_medications TEXT;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS allergies TEXT;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS habits TEXT;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS systems_review TEXT;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS other_symptoms TEXT;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS findings TEXT;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS instructions TEXT;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS follow_up TEXT;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS prevention TEXT;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS occupation TEXT;

COMMENT ON COLUMN medical_records.record_type IS 'Type: primera_consulta, seguimiento, urgencia, control';
COMMENT ON COLUMN medical_records.personal_history IS 'Antecedentes personales evaluados';
COMMENT ON COLUMN medical_records.family_history IS 'Antecedentes familiares';
COMMENT ON COLUMN medical_records.current_medications IS 'Medicación habitual';
COMMENT ON COLUMN medical_records.allergies IS 'Alergias reportadas en la consulta';
COMMENT ON COLUMN medical_records.habits IS 'Hábitos evaluados (tabaco, alcohol, ejercicio, etc.)';
COMMENT ON COLUMN medical_records.systems_review IS 'Revisión por sistemas';
COMMENT ON COLUMN medical_records.other_symptoms IS 'Otros síntomas / negativos';
COMMENT ON COLUMN medical_records.findings IS 'Hallazgos relevantes del examen';
COMMENT ON COLUMN medical_records.instructions IS 'Indicaciones al paciente';
COMMENT ON COLUMN medical_records.follow_up IS 'Plan de seguimiento';
COMMENT ON COLUMN medical_records.prevention IS 'Prevención evaluada';
COMMENT ON COLUMN medical_records.occupation IS 'Ocupación del paciente al momento de la consulta';
