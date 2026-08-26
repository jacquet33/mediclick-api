-- ============================================================
-- MediClick — Migración 003
-- Endurecimiento de autenticación
--
-- Idempotente.
--   docker exec -i mediclick-db psql -U mediclick -d mediclick < 003_auth_hardening.sql
-- ============================================================

-- Flag de staff de plataforma (acceso al panel de cobertura y config del hub)
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_doctors_platform_admin
  ON doctors(is_platform_admin) WHERE is_platform_admin;

-- Token de sesión para el panel interno (no expone el JWT del médico en la URL)
CREATE TABLE IF NOT EXISTS admin_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    token VARCHAR(64) UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '8 hours'),
    ip_address INET,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_exp ON admin_sessions(expires_at);
