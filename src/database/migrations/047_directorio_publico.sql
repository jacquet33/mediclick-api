-- Visibilidad en el buscador público del inicio. Los médicos existentes (pruebas y cuentas previas al lanzamiento
-- comercial) quedan ocultos; sus cuentas, pacientes, turnos y links directos de reserva siguen funcionando.
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS en_directorio BOOLEAN NOT NULL DEFAULT true;
UPDATE doctors SET en_directorio = false WHERE created_at < '2026-11-27 00:00:00-03';
