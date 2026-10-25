-- Migration 017: Firma electrónica — datos del profesional en cada registro médico
-- Ley 26.529: cada entrada de HC debe identificar al profesional que la creó
-- Se guarda snapshot al momento de creación (si el doctor cambia de especialidad, el registro original conserva la data original)

ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS doctor_license VARCHAR(50);
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS doctor_license_province VARCHAR(100);
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS doctor_specialty VARCHAR(100);
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS doctor_full_name VARCHAR(200);

COMMENT ON COLUMN medical_records.doctor_license IS 'Matrícula del profesional al momento de firmar (Ley 26.529 firma electrónica)';
COMMENT ON COLUMN medical_records.doctor_license_province IS 'Provincia de la matrícula al momento de firmar';
COMMENT ON COLUMN medical_records.doctor_specialty IS 'Especialidad del profesional al momento de firmar';
COMMENT ON COLUMN medical_records.doctor_full_name IS 'Nombre completo del profesional al momento de firmar';

-- Backfill existing records with current doctor data
UPDATE medical_records mr
SET doctor_license = d.medical_license,
    doctor_license_province = d.medical_license_province,
    doctor_specialty = d.specialty,
    doctor_full_name = d.first_name || ' ' || d.last_name
FROM doctors d
WHERE mr.doctor_id = d.id
  AND mr.doctor_license IS NULL;
