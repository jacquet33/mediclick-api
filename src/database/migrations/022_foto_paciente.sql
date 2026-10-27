-- 022: foto del paciente (aparte de la tabla patients para no cargarla en los listados)
CREATE TABLE IF NOT EXISTS patient_photos (
    patient_id UUID PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
    data_url TEXT NOT NULL,              -- data:image/jpeg;base64,... (la web la achica a 512 px)
    uploaded_by UUID,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
