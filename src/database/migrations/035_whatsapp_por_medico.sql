-- WhatsApp Business propio de cada médico (conectado con el registro integrado de Meta)
CREATE TABLE IF NOT EXISTS doctor_whatsapp_accounts (
  doctor_id UUID PRIMARY KEY REFERENCES doctors(id) ON DELETE CASCADE,
  waba_id VARCHAR(40) NOT NULL,
  phone_number_id VARCHAR(40) NOT NULL,
  display_phone VARCHAR(40),
  verified_name VARCHAR(200),
  token_enc BYTEA NOT NULL,              -- token de Meta cifrado (pgp_sym_encrypt con ENCRYPTION_KEY)
  templates JSONB,                       -- estado de las plantillas creadas en su cuenta
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doc_wa_phone ON doctor_whatsapp_accounts (phone_number_id);
CREATE EXTENSION IF NOT EXISTS pgcrypto;
