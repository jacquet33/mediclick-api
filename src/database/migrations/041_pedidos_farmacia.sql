-- Pedidos de recetas a farmacias habilitadas: el paciente elige la farmacia, ella confirma stock y precio,
-- y entrega en el mostrador (o con envío, si la farmacia lo ofrece y su jurisdicción lo permite).
-- TusRecetasMed no vende ni cobra medicamentos: solo conecta al paciente con la farmacia.
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS acepta_pedidos BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS hace_envios BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS horario VARCHAR(200);

CREATE TABLE IF NOT EXISTS pedidos_farmacia (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prescription_id UUID NOT NULL REFERENCES prescriptions(id),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id),
  token VARCHAR(48) NOT NULL UNIQUE,
  modalidad VARCHAR(10) NOT NULL DEFAULT 'retiro' CHECK (modalidad IN ('retiro','envio')),
  direccion TEXT,
  telefono VARCHAR(30) NOT NULL,
  notas TEXT,
  estado VARCHAR(15) NOT NULL DEFAULT 'enviado'
    CHECK (estado IN ('enviado','confirmado','listo','entregado','rechazado','cancelado')),
  total NUMERIC(12,2),
  mensaje_farmacia TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pedidos_farmacia_ph ON pedidos_farmacia (pharmacy_id, estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_farmacia_rx ON pedidos_farmacia (prescription_id);
