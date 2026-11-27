-- Baja de la cuenta pedida por el médico desde la app o la web
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS cuenta_eliminada_at TIMESTAMPTZ;
