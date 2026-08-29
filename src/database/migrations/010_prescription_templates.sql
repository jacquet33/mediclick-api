-- ============================================================
-- MediClick - Migration 010: Templates de recetas
-- Plantillas reutilizables para prescripciones comunes
-- ============================================================

CREATE TABLE prescription_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    
    -- Info
    name VARCHAR(200) NOT NULL,            -- "Gripe común", "HTA - inicio"
    category VARCHAR(100),                 -- "Respiratorio", "Cardiovascular", etc.
    diagnosis VARCHAR(300),
    diagnosis_code VARCHAR(20),            -- CIE-10
    notes TEXT,
    
    -- Visibilidad
    is_shared BOOLEAN DEFAULT false,       -- Compartir con la organización
    use_count INT DEFAULT 0,               -- Cuántas veces se usó
    
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE prescription_template_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID NOT NULL REFERENCES prescription_templates(id) ON DELETE CASCADE,
    medication_name VARCHAR(200) NOT NULL,
    dosage VARCHAR(100),
    frequency VARCHAR(200),
    duration VARCHAR(100),
    quantity INT,
    instructions TEXT,
    sort_order SMALLINT DEFAULT 0
);

CREATE INDEX idx_rx_templates_doctor ON prescription_templates(doctor_id);
CREATE INDEX idx_rx_templates_org ON prescription_templates(organization_id) WHERE is_shared = true;
CREATE INDEX idx_rx_template_items ON prescription_template_items(template_id);

CREATE TRIGGER trg_rx_templates_upd
    BEFORE UPDATE ON prescription_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Templates comunes pre-cargados (para todos los doctores) ──

DO $$
DECLARE v_doc_id UUID;
BEGIN
FOR v_doc_id IN SELECT id FROM doctors LOOP

-- Gripe / Resfrío común
INSERT INTO prescription_templates (doctor_id, name, category, diagnosis, diagnosis_code) 
VALUES (v_doc_id, 'Gripe / Resfrío común', 'Respiratorio', 'Infección aguda de las vías respiratorias superiores', 'J06.9');
INSERT INTO prescription_template_items (template_id, medication_name, dosage, frequency, duration, quantity, sort_order) VALUES
    ((SELECT id FROM prescription_templates WHERE doctor_id = v_doc_id AND name = 'Gripe / Resfrío común'),
     'Paracetamol', '500mg', '1 comprimido cada 6-8 horas si hay fiebre o dolor', '5 días', 20, 1),
    ((SELECT id FROM prescription_templates WHERE doctor_id = v_doc_id AND name = 'Gripe / Resfrío común'),
     'Loratadina', '10mg', '1 comprimido por la mañana', '5 días', 5, 2);

-- Faringitis
INSERT INTO prescription_templates (doctor_id, name, category, diagnosis, diagnosis_code) 
VALUES (v_doc_id, 'Faringitis aguda', 'Respiratorio', 'Faringitis aguda', 'J02.9');
INSERT INTO prescription_template_items (template_id, medication_name, dosage, frequency, duration, quantity, sort_order) VALUES
    ((SELECT id FROM prescription_templates WHERE doctor_id = v_doc_id AND name = 'Faringitis aguda'),
     'Amoxicilina', '500mg', '1 comprimido cada 8 horas', '7 días', 21, 1),
    ((SELECT id FROM prescription_templates WHERE doctor_id = v_doc_id AND name = 'Faringitis aguda'),
     'Ibuprofeno', '400mg', '1 comprimido cada 8 horas si hay dolor', '5 días', 15, 2);

-- Lumbalgia
INSERT INTO prescription_templates (doctor_id, name, category, diagnosis, diagnosis_code) 
VALUES (v_doc_id, 'Lumbalgia aguda', 'Traumatología', 'Lumbalgia', 'M54.5');
INSERT INTO prescription_template_items (template_id, medication_name, dosage, frequency, duration, quantity, sort_order) VALUES
    ((SELECT id FROM prescription_templates WHERE doctor_id = v_doc_id AND name = 'Lumbalgia aguda'),
     'Diclofenac', '75mg', '1 comprimido cada 12 horas', '5 días', 10, 1),
    ((SELECT id FROM prescription_templates WHERE doctor_id = v_doc_id AND name = 'Lumbalgia aguda'),
     'Ciclobenzaprina', '10mg', '1 comprimido antes de dormir', '7 días', 7, 2),
    ((SELECT id FROM prescription_templates WHERE doctor_id = v_doc_id AND name = 'Lumbalgia aguda'),
     'Omeprazol', '20mg', '1 cápsula en ayunas (protector gástrico)', '5 días', 5, 3);

-- HTA inicio
INSERT INTO prescription_templates (doctor_id, name, category, diagnosis, diagnosis_code) 
VALUES (v_doc_id, 'HTA - Inicio tratamiento', 'Cardiovascular', 'Hipertensión arterial esencial', 'I10');
INSERT INTO prescription_template_items (template_id, medication_name, dosage, frequency, duration, quantity, sort_order) VALUES
    ((SELECT id FROM prescription_templates WHERE doctor_id = v_doc_id AND name = 'HTA - Inicio tratamiento'),
     'Enalapril', '10mg', '1 comprimido cada 12 horas', '30 días', 60, 1);

-- ITU
INSERT INTO prescription_templates (doctor_id, name, category, diagnosis, diagnosis_code) 
VALUES (v_doc_id, 'Infección urinaria', 'Urología', 'Infección de vías urinarias', 'N39.0');
INSERT INTO prescription_template_items (template_id, medication_name, dosage, frequency, duration, quantity, sort_order) VALUES
    ((SELECT id FROM prescription_templates WHERE doctor_id = v_doc_id AND name = 'Infección urinaria'),
     'Cefalexina', '500mg', '1 comprimido cada 6 horas', '7 días', 28, 1);

-- Gastritis
INSERT INTO prescription_templates (doctor_id, name, category, diagnosis, diagnosis_code) 
VALUES (v_doc_id, 'Gastritis', 'Gastroenterología', 'Gastritis, no especificada', 'K29.7');
INSERT INTO prescription_template_items (template_id, medication_name, dosage, frequency, duration, quantity, sort_order) VALUES
    ((SELECT id FROM prescription_templates WHERE doctor_id = v_doc_id AND name = 'Gastritis'),
     'Omeprazol', '20mg', '1 cápsula en ayunas', '14 días', 14, 1),
    ((SELECT id FROM prescription_templates WHERE doctor_id = v_doc_id AND name = 'Gastritis'),
     'Sucralfato', '1g', '1 sobre antes de cada comida', '14 días', 42, 2);

END LOOP;
END $$;

RAISE NOTICE '✅ Migración 010: templates de recetas + 6 plantillas comunes pre-cargadas';
