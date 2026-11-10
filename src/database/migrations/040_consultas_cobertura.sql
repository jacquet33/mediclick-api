-- Consultas de cobertura al padrón oficial (SISA WS042: PUCO + SSSalud), con caché de 24 h
CREATE TABLE IF NOT EXISTS cobertura_consultas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dni VARCHAR(12) NOT NULL,
  sexo CHAR(1),
  resultado JSONB NOT NULL,
  consultado_por UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cobertura_consultas_dni ON cobertura_consultas (dni, created_at DESC);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS cobertura_verificada_at TIMESTAMPTZ;
