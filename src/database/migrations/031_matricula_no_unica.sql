-- La misma matrícula provincial (MP) se repite entre provincias: no puede ser única en todo el país.
-- La identidad del médico la da su DNI (validado en REFEPS); la matrícula se distingue por tipo y provincia.
ALTER TABLE doctors DROP CONSTRAINT IF EXISTS doctors_medical_license_key;
DROP INDEX IF EXISTS doctors_medical_license_key;
CREATE INDEX IF NOT EXISTS idx_doctors_dni ON doctors (dni) WHERE dni IS NOT NULL;
