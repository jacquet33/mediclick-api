-- Actividad de acceso (logins, fallos, altas) para el administrador de la plataforma
CREATE TABLE IF NOT EXISTS auth_events (
  id BIGSERIAL PRIMARY KEY,
  kind VARCHAR(30) NOT NULL,          -- login_ok | login_fail | register_doctor | register_patient | google_ok | google_fail
  user_type VARCHAR(20),
  user_id UUID,
  email VARCHAR(255),
  detail VARCHAR(200),
  ip VARCHAR(64),
  user_agent VARCHAR(300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_events_time ON auth_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_events_email ON auth_events (email, created_at DESC);

-- Recordatorios por email a médicos que empezaron el alta y no la terminaron
CREATE TABLE IF NOT EXISTS doctor_onboarding_emails (
  id BIGSERIAL PRIMARY KEY,
  doctor_id UUID NOT NULL REFERENCES doctors(id),
  step SMALLINT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ok BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (doctor_id, step)
);
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS onboarding_emails_opt_out BOOLEAN NOT NULL DEFAULT false;
-- Solo se recuerda a quienes se registren desde que existe esta función (no se escribe a altas viejas)
CREATE TABLE IF NOT EXISTS platform_settings (key VARCHAR(80) PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ DEFAULT now());
INSERT INTO platform_settings (key, value) VALUES ('onboarding_emails_since', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) ON CONFLICT (key) DO NOTHING;
