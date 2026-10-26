-- Migration 019: Ley 27.553 — campos requeridos para receta electrónica
-- CUIL paciente, REFEPS doctor, forma farmacéutica en items de receta

-- Pacientes: agregar CUIL (Clave Única de Identificación Laboral)
ALTER TABLE patients ADD COLUMN IF NOT EXISTS cuil VARCHAR(13);

-- Doctores: agregar código REFEPS (Registro Federal de Establecimientos de Salud)
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS refeps_code VARCHAR(50);

-- Items de receta: agregar forma farmacéutica y presentación
ALTER TABLE prescription_items ADD COLUMN IF NOT EXISTS pharmaceutical_form VARCHAR(100);
ALTER TABLE prescription_items ADD COLUMN IF NOT EXISTS presentation VARCHAR(100);
ALTER TABLE prescription_items ADD COLUMN IF NOT EXISTS generic_name VARCHAR(200);

-- Índice para búsqueda de recetas por código de verificación (endpoint público)
CREATE INDEX IF NOT EXISTS idx_prescriptions_verification_code ON prescriptions(verification_code);
