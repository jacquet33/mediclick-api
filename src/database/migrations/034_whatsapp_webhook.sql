-- Eventos que manda Meta (WhatsApp Cloud API): estados de los mensajes enviados y mensajes entrantes
CREATE TABLE IF NOT EXISTS whatsapp_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind VARCHAR(20) NOT NULL,            -- status | message | other
  wamid VARCHAR(200),                   -- id del mensaje en WhatsApp
  status VARCHAR(30),                   -- sent | delivered | read | failed
  phone_number_id VARCHAR(40),          -- número emisor/receptor del lado del médico o plataforma
  from_phone VARCHAR(30),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_events_wamid ON whatsapp_events (wamid);
CREATE INDEX IF NOT EXISTS idx_wa_events_created ON whatsapp_events (created_at DESC);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS whatsapp_reminder_wamid VARCHAR(200);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS whatsapp_reminder_status VARCHAR(30);
CREATE INDEX IF NOT EXISTS idx_appt_wa_wamid ON appointments (whatsapp_reminder_wamid) WHERE whatsapp_reminder_wamid IS NOT NULL;
