-- Tienda online de cada farmacia: sucursales, catálogo, pedidos con pago por Mercado Pago a la cuenta
-- de la farmacia (marketplace) y retiro en sucursal. Bajo receta no se vende acá: va por pedidos_farmacia.
CREATE TABLE IF NOT EXISTS farmacia_tiendas (
  pharmacy_id UUID PRIMARY KEY REFERENCES pharmacies(id) ON DELETE CASCADE,
  slug VARCHAR(60) NOT NULL UNIQUE,
  nombre VARCHAR(150) NOT NULL,
  descripcion TEXT,
  logo_url TEXT,
  activa BOOLEAN NOT NULL DEFAULT false,
  whatsapp VARCHAR(30),
  mp_user_id VARCHAR(40),
  mp_access_token_enc BYTEA,
  mp_refresh_token_enc BYTEA,
  mp_expires_at TIMESTAMPTZ,
  mp_conectado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS farmacia_sucursales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  nombre VARCHAR(120) NOT NULL,
  direccion VARCHAR(250) NOT NULL,
  ciudad VARCHAR(100),
  telefono VARCHAR(30),
  horario VARCHAR(200),
  activa BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_farmacia_sucursales_ph ON farmacia_sucursales (pharmacy_id);

CREATE TABLE IF NOT EXISTS farmacia_productos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  nombre VARCHAR(200) NOT NULL,
  descripcion TEXT,
  categoria VARCHAR(60) NOT NULL DEFAULT 'Otros',
  precio NUMERIC(12,2) NOT NULL CHECK (precio >= 0),
  foto_url TEXT,
  codigo VARCHAR(60),
  venta_libre BOOLEAN NOT NULL DEFAULT false,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_farmacia_productos_ph ON farmacia_productos (pharmacy_id, activo, categoria);

-- Stock por sucursal (sin fila = sin control de stock: se puede pedir)
CREATE TABLE IF NOT EXISTS farmacia_stock (
  producto_id UUID NOT NULL REFERENCES farmacia_productos(id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES farmacia_sucursales(id) ON DELETE CASCADE,
  cantidad INT NOT NULL DEFAULT 0,
  PRIMARY KEY (producto_id, sucursal_id)
);

CREATE TABLE IF NOT EXISTS tienda_pedidos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero SERIAL,
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id),
  sucursal_id UUID NOT NULL REFERENCES farmacia_sucursales(id),
  token VARCHAR(48) NOT NULL UNIQUE,
  nombre VARCHAR(150) NOT NULL,
  telefono VARCHAR(30) NOT NULL,
  email VARCHAR(150),
  items JSONB NOT NULL,
  total NUMERIC(12,2) NOT NULL,
  comision NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado VARCHAR(20) NOT NULL DEFAULT 'pendiente_pago'
    CHECK (estado IN ('pendiente_pago','pagado','preparando','listo','entregado','cancelado')),
  mp_preference_id VARCHAR(80),
  mp_payment_id VARCHAR(40),
  pagado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tienda_pedidos_ph ON tienda_pedidos (pharmacy_id, estado, created_at DESC);
