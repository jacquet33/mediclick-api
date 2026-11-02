-- Cuántas veces el paciente cargó/corrigió el número del recordatorio (tope para evitar abusos)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS whatsapp_reminder_changes SMALLINT NOT NULL DEFAULT 0;
