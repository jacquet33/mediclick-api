-- Recordatorio por WhatsApp: manual (el consultorio lo envía con un botón) o automático (API de Meta)
ALTER TABLE doctor_reminder_settings ADD COLUMN IF NOT EXISTS whatsapp_reminder_mode VARCHAR(10) NOT NULL DEFAULT 'manual';
ALTER TABLE doctor_reminder_settings ADD COLUMN IF NOT EXISTS whatsapp_reminder_all BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS whatsapp_reminder_channel VARCHAR(10);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS whatsapp_reminder_sent_by UUID;

-- Plantillas de receta con nombre genérico, forma y presentación
ALTER TABLE prescription_template_items ADD COLUMN IF NOT EXISTS generic_name VARCHAR(200);
ALTER TABLE prescription_template_items ADD COLUMN IF NOT EXISTS pharmaceutical_form VARCHAR(100);
ALTER TABLE prescription_template_items ADD COLUMN IF NOT EXISTS presentation VARCHAR(100);
ALTER TABLE prescription_template_items ALTER COLUMN dosage DROP NOT NULL;
ALTER TABLE prescription_template_items ALTER COLUMN frequency DROP NOT NULL;

-- Tiempo que lleva armar cada receta (para medir el tiempo ahorrado) y alertas que el médico confirmó
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS compose_seconds INTEGER;
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS alerts_acknowledged JSONB;

-- Antecedentes del paciente (resumen clínico de la ficha)
ALTER TABLE patients ADD COLUMN IF NOT EXISTS personal_history TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS surgical_history TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS family_history TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS habits TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS clinical_summary_updated_at TIMESTAMPTZ;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS clinical_summary_updated_by UUID;

-- Estudios, informes y documentos del paciente (se pueden compartir con el paciente)
CREATE TABLE IF NOT EXISTS patient_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  medical_record_id UUID REFERENCES medical_records(id),
  uploaded_by_type VARCHAR(20) NOT NULL DEFAULT 'doctor',
  uploaded_by UUID,
  kind VARCHAR(30) NOT NULL DEFAULT 'estudio',   -- estudio | informe | indicaciones | imagen | otro
  title VARCHAR(200) NOT NULL,
  description TEXT,
  study_date DATE,
  mime_type VARCHAR(100),
  file_name VARCHAR(200),
  size_bytes INTEGER,
  content BYTEA,
  body_text TEXT,                                  -- indicaciones escritas (sin archivo)
  shared_with_patient BOOLEAN NOT NULL DEFAULT false,
  shared_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_patient_docs ON patient_documents (patient_id, created_at DESC) WHERE deleted_at IS NULL;

-- Uso del asistente de IA (auditoría: quién, sobre qué paciente, qué tarea; no se guarda el texto clínico)
CREATE TABLE IF NOT EXISTS ai_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID,
  doctor_id UUID,
  patient_id UUID,
  task VARCHAR(40) NOT NULL,
  provider VARCHAR(30),
  input_chars INTEGER,
  output_chars INTEGER,
  ok BOOLEAN NOT NULL DEFAULT true,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_requests_doc ON ai_requests (doctor_id, created_at DESC);

-- Referidos entre médicos
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS referral_code VARCHAR(16);
CREATE UNIQUE INDEX IF NOT EXISTS uq_doctors_referral_code ON doctors (referral_code) WHERE referral_code IS NOT NULL;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS referred_by_doctor_id UUID REFERENCES doctors(id);
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS referred_at TIMESTAMPTZ;
