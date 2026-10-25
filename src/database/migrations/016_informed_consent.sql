-- Migration 016: Consentimiento informado digital
-- Cumplimiento Ley 26.529 Art. 5 — Consentimiento informado para HC digital

CREATE TABLE IF NOT EXISTS informed_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  doctor_id UUID NOT NULL REFERENCES doctors(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  consent_type VARCHAR(50) NOT NULL DEFAULT 'historia_clinica_digital',
  consent_text TEXT NOT NULL,
  accepted BOOLEAN NOT NULL DEFAULT FALSE,
  accepted_at TIMESTAMPTZ,
  ip_address VARCHAR(45),
  user_agent TEXT,
  signature_data TEXT, -- base64 de firma digital del paciente (opcional)
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consents_patient ON informed_consents(patient_id);
CREATE INDEX IF NOT EXISTS idx_consents_doctor ON informed_consents(doctor_id);
CREATE INDEX IF NOT EXISTS idx_consents_org ON informed_consents(organization_id);
CREATE INDEX IF NOT EXISTS idx_consents_type ON informed_consents(consent_type);

COMMENT ON TABLE informed_consents IS 'Consentimientos informados digitales (Ley 26.529 Art. 5)';

-- Audit trigger for consents
CREATE OR REPLACE FUNCTION fn_audit_consents()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (table_name, record_id, action, new_data, changed_by)
    VALUES ('informed_consents', NEW.id, 'INSERT', to_jsonb(NEW), NEW.doctor_id);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
    VALUES ('informed_consents', NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), NEW.doctor_id);
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_consents ON informed_consents;
CREATE TRIGGER trg_audit_consents
  AFTER INSERT OR UPDATE ON informed_consents
  FOR EACH ROW EXECUTE FUNCTION fn_audit_consents();
