-- Un WhatsApp para todo el consultorio / clínica (secretaría): los avisos de los demás profesionales
-- del mismo consultorio salen desde ese número si no tienen uno propio.
ALTER TABLE doctor_whatsapp_accounts ADD COLUMN IF NOT EXISTS compartido BOOLEAN NOT NULL DEFAULT false;
