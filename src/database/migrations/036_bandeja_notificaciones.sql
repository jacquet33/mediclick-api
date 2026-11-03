-- Bandeja de notificaciones de la app (campanita): queda guardada aunque el celular no tenga push activado
CREATE TABLE IF NOT EXISTS inbox_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_type VARCHAR(20) NOT NULL,     -- doctor | staff | patient
  recipient_id UUID NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  category VARCHAR(50),
  data JSONB DEFAULT '{}',
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inbox_recipient ON inbox_notifications (recipient_type, recipient_id, created_at DESC);
