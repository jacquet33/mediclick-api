-- Migration 015: Audit log, access logs, and soft-delete for inalterabilidad
-- Cumplimiento Ley 26.529 (Historia Clínica Digital) — trazabilidad e inalterabilidad

-- 1. Audit log — tracks every change to clinical data
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name VARCHAR(100) NOT NULL,
  record_id UUID NOT NULL,
  action VARCHAR(10) NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_data JSONB,
  new_data JSONB,
  changed_by UUID,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address VARCHAR(45),
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_by ON audit_log(changed_by);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at ON audit_log(changed_at);

COMMENT ON TABLE audit_log IS 'Registro de auditoría — cambios en datos clínicos (Ley 26.529 inalterabilidad)';

-- 2. Access logs — tracks who accessed what and when
CREATE TABLE IF NOT EXISTS access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('doctor', 'secretary', 'patient', 'system')),
  action VARCHAR(50) NOT NULL,
  resource_type VARCHAR(50),
  resource_id UUID,
  ip_address VARCHAR(45),
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_access_logs_user_id ON access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_access_logs_action ON access_logs(action);

COMMENT ON TABLE access_logs IS 'Registro de acceso — quién vio qué y cuándo (Ley 26.529 trazabilidad)';

-- 3. Soft-delete column for medical_records (inalterabilidad — never physically delete)
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN medical_records.deleted_at IS 'Soft-delete timestamp — registros clínicos nunca se borran físicamente (Ley 26.529)';

-- 4. Trigger function to auto-log changes on medical_records
CREATE OR REPLACE FUNCTION fn_audit_medical_records()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (table_name, record_id, action, new_data, changed_by)
    VALUES ('medical_records', NEW.id, 'INSERT', to_jsonb(NEW), NEW.doctor_id);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
    VALUES ('medical_records', NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), NEW.doctor_id);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log (table_name, record_id, action, old_data, changed_by)
    VALUES ('medical_records', OLD.id, 'DELETE', to_jsonb(OLD), OLD.doctor_id);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if any, then create
DROP TRIGGER IF EXISTS trg_audit_medical_records ON medical_records;
CREATE TRIGGER trg_audit_medical_records
  AFTER INSERT OR UPDATE OR DELETE ON medical_records
  FOR EACH ROW EXECUTE FUNCTION fn_audit_medical_records();

-- 5. Also audit appointments changes (status changes are clinically relevant)
CREATE OR REPLACE FUNCTION fn_audit_appointments()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO audit_log (table_name, record_id, action, old_data, new_data)
    VALUES ('appointments', NEW.id, 'UPDATE',
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_appointments ON appointments;
CREATE TRIGGER trg_audit_appointments
  AFTER UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION fn_audit_appointments();
