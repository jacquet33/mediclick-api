-- 027: alta de médicos (medicos.rispy.io): prefijo, foto del DNI
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS title_prefix VARCHAR(6);   -- 'Dr.' | 'Dra.'
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS dni_document TEXT;         -- foto del documento (data URL)
