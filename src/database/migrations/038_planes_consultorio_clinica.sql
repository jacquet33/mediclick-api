-- Planes con cupo explícito de avisos automáticos de WhatsApp:
-- Profesional $9.000 (1 profesional, 1.000 avisos/mes) · Consultorio $19.000 (hasta 3, 3.000 avisos/mes)
-- Clínica $39.000 (hasta 10, avisos ilimitados)
INSERT INTO mp_plans (internal_plan, name, description, amount, currency) VALUES
  ('pro', 'TusRecetasMed Profesional', '1 profesional · 1.000 avisos automáticos por WhatsApp al mes', 9000, 'ARS'),
  ('centro', 'TusRecetasMed Consultorio', 'Hasta 3 profesionales · 3.000 avisos automáticos por WhatsApp al mes', 19000, 'ARS'),
  ('clinica', 'TusRecetasMed Clínica', 'Hasta 10 profesionales · avisos automáticos por WhatsApp ilimitados', 39000, 'ARS')
ON CONFLICT (internal_plan) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, amount = EXCLUDED.amount,
  currency = EXCLUDED.currency, is_active = true, updated_at = now();
UPDATE mp_plans SET is_active = false, updated_at = now() WHERE internal_plan = 'centro10';
