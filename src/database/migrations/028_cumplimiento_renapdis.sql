-- 028: requisitos para la inscripción en ReNaPDiS
-- (Ley 26.529 inalterabilidad de la HC, Ley 25.326 derechos del titular, acceso de cualquier farmacia, CUIR Res. 2214/2025)

-- ─── Historia clínica inalterable: cada cambio guarda la versión anterior y no se puede borrar ───
CREATE TABLE IF NOT EXISTS medical_record_versions (
    id BIGSERIAL PRIMARY KEY,
    record_id UUID NOT NULL REFERENCES medical_records(id),
    version INT NOT NULL,
    data JSONB NOT NULL,                 -- la fila completa antes del cambio
    changed_by UUID,
    change_reason TEXT,
    changed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (record_id, version)
);
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS change_reason TEXT;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS annulled_reason TEXT;

CREATE OR REPLACE FUNCTION hc_versionar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO medical_record_versions (record_id, version, data, changed_by, change_reason)
  VALUES (OLD.id, COALESCE(OLD.version, 1), to_jsonb(OLD), NEW.updated_by, NEW.change_reason)
  ON CONFLICT (record_id, version) DO NOTHING;
  NEW.version := COALESCE(OLD.version, 1) + 1;
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hc_versionar ON medical_records;
CREATE TRIGGER trg_hc_versionar BEFORE UPDATE ON medical_records FOR EACH ROW EXECUTE FUNCTION hc_versionar();

CREATE OR REPLACE FUNCTION hc_no_borrar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La historia clínica no se puede borrar (Ley 26.529): se anula con motivo';
END $$;
DROP TRIGGER IF EXISTS trg_hc_no_borrar ON medical_records;
CREATE TRIGGER trg_hc_no_borrar BEFORE DELETE ON medical_records FOR EACH ROW EXECUTE FUNCTION hc_no_borrar();
DROP TRIGGER IF EXISTS trg_hc_versiones_no_borrar ON medical_record_versions;
CREATE TRIGGER trg_hc_versiones_no_borrar BEFORE DELETE OR UPDATE ON medical_record_versions FOR EACH ROW EXECUTE FUNCTION hc_no_borrar();

-- ─── Farmacias: cualquier farmacia habilitada se registra sola ───
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS self_registered BOOLEAN DEFAULT false;
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS reviewed BOOLEAN DEFAULT false;

-- ─── Ley 25.326: pedidos del titular de los datos (acceso, rectificación, supresión) ───
CREATE TABLE IF NOT EXISTS data_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requester_type VARCHAR(20) NOT NULL,         -- patient | doctor | public
    patient_id UUID, doctor_id UUID,
    full_name VARCHAR(200), dni VARCHAR(20), email VARCHAR(255),
    kind VARCHAR(20) NOT NULL,                   -- acceso | rectificacion | supresion | oposicion
    detail TEXT,
    status VARCHAR(20) DEFAULT 'pending',        -- pending | done | rejected
    response TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    due_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '10 days'   -- plazo legal de respuesta al acceso
);

-- ─── CUIR numérico (Res. 2214/2025 Anexo IV) ───
CREATE SEQUENCE IF NOT EXISTS cuir_group_seq START 1;
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS cuir_group BIGINT;
ALTER TABLE prescription_items ADD COLUMN IF NOT EXISTS cuir VARCHAR(45);
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS patient_cuil VARCHAR(13);

-- Envío al repositorio central del Ministerio (Anexo IV)
CREATE TABLE IF NOT EXISTS central_repo_submissions (
    id BIGSERIAL PRIMARY KEY,
    prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending',       -- pending | sent | error | disabled
    attempts INT DEFAULT 0,
    last_error TEXT,
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    UNIQUE (prescription_id)
);
