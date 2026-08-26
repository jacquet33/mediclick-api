-- ============================================================
-- MediClick — Migración 004
-- Valor de galeno/unidad por versión de nomenclador
--
-- Idempotente.
--   docker exec -i mediclick-db psql -U mediclick -d mediclick < 004_nomenclator_unit_value.sql
-- ============================================================

-- Muchos nomencladores no traen el importe final sino unidades
-- (galenos). El importe sale de multiplicar las unidades por el
-- valor vigente del galeno, que se actualiza por separado.
ALTER TABLE nomenclators ADD COLUMN IF NOT EXISTS unit_value DECIMAL(12,4);

COMMENT ON COLUMN nomenclators.unit_value IS
  'Valor del galeno/unidad para este período. NULL si los items traen importe directo.';

-- Código de consulta por defecto de cada convenio, para armar
-- el lote automáticamente desde los turnos completados.
ALTER TABLE nomenclators ADD COLUMN IF NOT EXISTS default_consultation_code VARCHAR(30);

CREATE INDEX IF NOT EXISTS idx_nomenclators_active_period
  ON nomenclators(insurer_id, valid_from DESC) WHERE is_active;
