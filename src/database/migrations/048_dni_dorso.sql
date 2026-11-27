-- Foto del dorso del DNI (frente + dorso para validar la identidad del profesional)
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS dni_document_back TEXT;
