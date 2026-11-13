-- Tienda online de farmacias: abono mensual fijo (sin comisión por venta)
CREATE TABLE IF NOT EXISTS farmacia_suscripciones (
  pharmacy_id UUID PRIMARY KEY REFERENCES pharmacies(id) ON DELETE CASCADE,
  mp_preapproval_id VARCHAR(60),
  estado VARCHAR(20) NOT NULL DEFAULT 'pending',
  monto NUMERIC(12,2) NOT NULL,
  proximo_cobro TIMESTAMPTZ,
  consultado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
