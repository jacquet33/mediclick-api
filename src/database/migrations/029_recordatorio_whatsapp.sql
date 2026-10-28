-- Recordatorio por WhatsApp un día antes, pedido por el propio paciente al reservar (opt-in explícito)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS whatsapp_reminder BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS whatsapp_reminder_phone VARCHAR(30);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS whatsapp_reminder_requested_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS whatsapp_reminder_sent_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS whatsapp_reminder_error TEXT;
CREATE INDEX IF NOT EXISTS idx_appt_wa_reminder ON appointments (date) WHERE whatsapp_reminder AND whatsapp_reminder_sent_at IS NULL;
