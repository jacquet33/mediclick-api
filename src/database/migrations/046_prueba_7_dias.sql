-- Nuevo esquema de precios: 7 días de prueba gratis y después plan pago.
-- Profesional $13.000 (1 profesional) · Consultorio $18.000 (hasta 5) · Clínica desde $40.000 (a convenir).
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS prueba_hasta TIMESTAMPTZ;
-- Los médicos que ya estaban registrados conservan el lanzamiento que se les ofreció (hasta el 31/03/2027).
UPDATE doctors SET prueba_hasta = '2027-03-31 23:59:59-03' WHERE prueba_hasta IS NULL;
-- Los nuevos tienen 7 días desde el alta.
ALTER TABLE doctors ALTER COLUMN prueba_hasta SET DEFAULT (now() + interval '7 days');

INSERT INTO mp_plans (internal_plan, name, description, amount, currency) VALUES
  ('pro', 'TusRecetasMed Profesional', '1 médico o consultorio · 1.000 avisos automáticos por WhatsApp al mes', 13000, 'ARS'),
  ('centro', 'TusRecetasMed Consultorio', 'Hasta 5 profesionales · 3.000 avisos automáticos por WhatsApp al mes', 18000, 'ARS'),
  ('clinica', 'TusRecetasMed Clínica', 'Clínicas y centros · avisos automáticos por WhatsApp ilimitados', 40000, 'ARS')
ON CONFLICT (internal_plan) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, amount = EXCLUDED.amount,
  currency = EXCLUDED.currency, is_active = true, updated_at = now();
