-- Catálogo de medicamentos comercializados en Argentina (marca, droga, presentación, laboratorio).
-- Se llena y actualiza solo desde el listado oficial publicado por PAMI en datos.gob.ar (código Alfabeta).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE IF NOT EXISTS medicamentos (
  alfabeta      INTEGER PRIMARY KEY,
  droga         TEXT NOT NULL,              -- principio activo (DCI), en minúscula como lo publica ANMAT
  marca         TEXT NOT NULL,
  presentacion  TEXT NOT NULL,              -- "16 mg comp.x 30"
  forma         TEXT,                       -- Comprimidos, Jarabe, Cápsulas… (deducida de la presentación)
  laboratorio   TEXT,
  cobertura_pami TEXT,                      -- "40%", "100%"…
  busqueda      TEXT NOT NULL,              -- marca + droga sin tildes, en minúscula
  activo        BOOLEAN NOT NULL DEFAULT true,
  fuente        TEXT NOT NULL DEFAULT 'PAMI - datos.gob.ar',
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_medicamentos_busqueda ON medicamentos USING gin (busqueda gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_medicamentos_droga ON medicamentos (droga);
CREATE INDEX IF NOT EXISTS idx_medicamentos_marca ON medicamentos (marca);
