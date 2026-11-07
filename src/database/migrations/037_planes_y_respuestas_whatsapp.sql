-- Planes (precios de la web), suscripción pendiente hasta que Mercado Pago confirme el pago,
-- cupo mensual de avisos automáticos de WhatsApp y respuestas automáticas.

-- La suscripción queda "pendiente" hasta que Mercado Pago apruebe el primer pago
ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'pending';

-- Precios publicados en tusrecetasmed.com/para-medicos
INSERT INTO mp_plans (internal_plan, name, description, amount, currency) VALUES
  ('pro', 'TusRecetasMed Profesional', 'Avisos automáticos ilimitados por WhatsApp, asistente con IA, documentos, sala de espera y soporte prioritario', 9000, 'ARS'),
  ('centro', 'TusRecetasMed Consultorio', 'Hasta 5 profesionales con todo lo de Profesional, secretarías sin costo y agenda del equipo', 19000, 'ARS'),
  ('centro10', 'TusRecetasMed Consultorio (6 a 10 profesionales)', 'De 6 a 10 profesionales con todo lo de Profesional', 34000, 'ARS')
ON CONFLICT (internal_plan) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, amount = EXCLUDED.amount,
  currency = EXCLUDED.currency, is_active = true, updated_at = now();

-- Registro de cada WhatsApp que manda la plataforma (para el cupo del plan y para el médico)
CREATE TABLE IF NOT EXISTS whatsapp_envios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  doctor_id UUID REFERENCES doctors(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  tipo VARCHAR(30) NOT NULL,        -- confirmacion | recordatorio | respuesta | prueba | limite | pregunta_cancelar
  telefono VARCHAR(30),
  wamid VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_envios_doctor_mes ON whatsapp_envios (doctor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wa_envios_tel ON whatsapp_envios (telefono, created_at);

-- Turno al que no se le mandó el aviso automático porque se llegó al cupo del plan (queda para envío manual)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS whatsapp_auto_omitido_at TIMESTAMPTZ;
-- El paciente confirmó su asistencia respondiendo por WhatsApp
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS paciente_confirmo_at TIMESTAMPTZ;

-- Respuestas automáticas por WhatsApp (confirmar / cancelar / "te respondemos a la brevedad")
ALTER TABLE doctor_reminder_settings ADD COLUMN IF NOT EXISTS wa_respuestas_auto BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE doctor_reminder_settings ADD COLUMN IF NOT EXISTS wa_respuesta_texto TEXT;
