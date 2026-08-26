-- ============================================================
-- MediClick - Seed data para testing
-- 10 pacientes, 20 turnos, recetas, historias clínicas, chat
-- Datos realistas argentinos (Entre Ríos)
-- ============================================================

-- Obtener IDs del doctor y org existentes
DO $$
DECLARE
    v_doctor_id UUID;
    v_org_id UUID;
    v_org_doctor_id UUID;
    v_patient_ids UUID[] := '{}';
    v_pid UUID;
    v_appt_id UUID;
    v_record_id UUID;
    v_rx_id UUID;
    v_conv_id UUID;
BEGIN

-- ─── Obtener doctor existente ──────────────────────────────
SELECT id INTO v_doctor_id FROM doctors WHERE email = 'alejandro@mediclick.app' LIMIT 1;
IF v_doctor_id IS NULL THEN
    RAISE EXCEPTION 'Doctor alejandro@mediclick.app no encontrado';
END IF;

-- ─── Obtener primera organización del doctor ───────────────
SELECT od.id, od.organization_id
INTO v_org_doctor_id, v_org_id
FROM organization_doctors od
WHERE od.doctor_id = v_doctor_id AND od.is_active = true
ORDER BY od.created_at
LIMIT 1;

IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró organización para el doctor';
END IF;

RAISE NOTICE 'Doctor: %, Org: %, OrgDoctor: %', v_doctor_id, v_org_id, v_org_doctor_id;

-- ═══════════════════════════════════════════════════════════
-- 10 PACIENTES
-- ═══════════════════════════════════════════════════════════

-- 1. María Elena Rodríguez
INSERT INTO patients (organization_id, dni, first_name, last_name, email, phone, date_of_birth, gender, blood_type, address, city, province, insurance_provider, insurance_number, insurance_plan, primary_doctor_id, allergies, chronic_conditions, current_medications)
VALUES (v_org_id, '25.432.876', 'María Elena', 'Rodríguez', 'maria.rodriguez@gmail.com', '3447-421234', '1978-03-15', 'female', 'A+', 'Av. 12 de Abril 456', 'Colón', 'Entre Ríos', 'IOSPER', '25432876-01', 'Plan A', v_doctor_id, ARRAY['Penicilina'], ARRAY['Hipertensión arterial'], ARRAY['Enalapril 10mg'])
RETURNING id INTO v_pid;
v_patient_ids := array_append(v_patient_ids, v_pid);

-- 2. Jorge Alberto Fernández
INSERT INTO patients (organization_id, dni, first_name, last_name, email, phone, date_of_birth, gender, blood_type, address, city, province, insurance_provider, insurance_number, primary_doctor_id, allergies, chronic_conditions, current_medications)
VALUES (v_org_id, '18.765.234', 'Jorge Alberto', 'Fernández', 'jorgefernandez@hotmail.com', '3447-456789', '1965-08-22', 'male', 'O+', 'Calle Urquiza 789', 'Colón', 'Entre Ríos', 'OSDE', '18765234-310', v_doctor_id, ARRAY[]::TEXT[], ARRAY['Diabetes tipo 2', 'Dislipemia'], ARRAY['Metformina 850mg', 'Atorvastatina 20mg'])
RETURNING id INTO v_pid;
v_patient_ids := array_append(v_patient_ids, v_pid);

-- 3. Luciana Belén Gómez
INSERT INTO patients (organization_id, dni, first_name, last_name, email, phone, date_of_birth, gender, blood_type, address, city, province, insurance_provider, insurance_number, primary_doctor_id, allergies, chronic_conditions)
VALUES (v_org_id, '35.987.654', 'Luciana Belén', 'Gómez', 'lu.gomez@gmail.com', '3447-567890', '1992-11-03', 'female', 'B+', 'Pasaje San Martín 123', 'San José', 'Entre Ríos', 'Swiss Medical', '35987654-02', v_doctor_id, ARRAY['Sulfas', 'Ibuprofeno'], ARRAY[]::TEXT[])
RETURNING id INTO v_pid;
v_patient_ids := array_append(v_patient_ids, v_pid);

-- 4. Carlos Raúl Martínez
INSERT INTO patients (organization_id, dni, first_name, last_name, phone, date_of_birth, gender, blood_type, address, city, province, insurance_provider, insurance_number, primary_doctor_id, chronic_conditions, current_medications)
VALUES (v_org_id, '20.345.678', 'Carlos Raúl', 'Martínez', '3447-234567', '1972-05-18', 'male', 'A-', 'Bv. Artigas 1456', 'Colón', 'Entre Ríos', 'IOSPER', '20345678-01', v_doctor_id, ARRAY['Hipotiroidismo'], ARRAY['Levotiroxina 75mcg'])
RETURNING id INTO v_pid;
v_patient_ids := array_append(v_patient_ids, v_pid);

-- 5. Ana Laura Pérez
INSERT INTO patients (organization_id, dni, first_name, last_name, email, phone, date_of_birth, gender, blood_type, address, city, province, insurance_provider, insurance_number, primary_doctor_id, allergies)
VALUES (v_org_id, '30.876.543', 'Ana Laura', 'Pérez', 'anaperez@gmail.com', '3447-345678', '1985-01-27', 'female', 'O-', 'Calle Paysandú 234', 'Colón', 'Entre Ríos', 'Galeno', '30876543-01', v_doctor_id, ARRAY['AAS'])
RETURNING id INTO v_pid;
v_patient_ids := array_append(v_patient_ids, v_pid);

-- 6. Roberto Daniel López
INSERT INTO patients (organization_id, dni, first_name, last_name, phone, date_of_birth, gender, blood_type, address, city, province, insurance_provider, insurance_number, primary_doctor_id, chronic_conditions, current_medications, emergency_contact_name, emergency_contact_phone)
VALUES (v_org_id, '15.234.567', 'Roberto Daniel', 'López', '3447-678901', '1958-09-10', 'male', 'AB+', 'Av. Costanera 567', 'Colón', 'Entre Ríos', 'PAMI', '15234567-01', v_doctor_id, ARRAY['EPOC', 'Fibrilación auricular', 'Hipertensión'], ARRAY['Salbutamol inh', 'Rivaroxabán 20mg', 'Losartán 50mg'], 'Marta López', '3447-112233')
RETURNING id INTO v_pid;
v_patient_ids := array_append(v_patient_ids, v_pid);

-- 7. Valentina Soledad Ruiz
INSERT INTO patients (organization_id, dni, first_name, last_name, email, phone, date_of_birth, gender, blood_type, address, city, province, insurance_provider, insurance_number, primary_doctor_id)
VALUES (v_org_id, '40.123.456', 'Valentina Soledad', 'Ruiz', 'valruiz@outlook.com', '3447-789012', '1998-06-14', 'female', 'A+', 'Calle Belgrano 890', 'Villa Elisa', 'Entre Ríos', 'OSDE', '40123456-210', v_doctor_id)
RETURNING id INTO v_pid;
v_patient_ids := array_append(v_patient_ids, v_pid);

-- 8. Héctor Oscar Díaz
INSERT INTO patients (organization_id, dni, first_name, last_name, phone, date_of_birth, gender, blood_type, address, city, province, insurance_provider, insurance_number, primary_doctor_id, chronic_conditions, current_medications)
VALUES (v_org_id, '22.567.890', 'Héctor Oscar', 'Díaz', '3447-890123', '1970-12-05', 'male', 'O+', 'Calle Sarmiento 345', 'Colón', 'Entre Ríos', 'IOSPER', '22567890-01', v_doctor_id, ARRAY['Gota', 'Hiperuricemia'], ARRAY['Alopurinol 300mg'])
RETURNING id INTO v_pid;
v_patient_ids := array_append(v_patient_ids, v_pid);

-- 9. Sofía Agustina Torres
INSERT INTO patients (organization_id, dni, first_name, last_name, email, phone, date_of_birth, gender, blood_type, address, city, province, insurance_provider, insurance_number, primary_doctor_id, allergies)
VALUES (v_org_id, '38.901.234', 'Sofía Agustina', 'Torres', 'sofitorres@gmail.com', '3447-901234', '1995-04-20', 'female', 'B-', 'Calle Mitre 678', 'San José', 'Entre Ríos', 'Swiss Medical', '38901234-01', v_doctor_id, ARRAY['Dipirona', 'Mariscos'])
RETURNING id INTO v_pid;
v_patient_ids := array_append(v_patient_ids, v_pid);

-- 10. Miguel Ángel Castro
INSERT INTO patients (organization_id, dni, first_name, last_name, phone, date_of_birth, gender, blood_type, address, city, province, primary_doctor_id, chronic_conditions, current_medications, notes)
VALUES (v_org_id, '28.654.321', 'Miguel Ángel', 'Castro', '3447-012345', '1980-07-30', 'male', 'A+', 'Ruta 26 Km 5', 'Colón', 'Entre Ríos', v_doctor_id, ARRAY['Asma'], ARRAY['Budesonide/Formoterol inh'], 'Particular - sin obra social. Trabaja en el campo.')
RETURNING id INTO v_pid;
v_patient_ids := array_append(v_patient_ids, v_pid);

RAISE NOTICE '✅ 10 pacientes creados';

-- ═══════════════════════════════════════════════════════════
-- HORARIOS DEL DOCTOR (Lun-Vie 8:00-12:00 y 16:00-20:00)
-- ═══════════════════════════════════════════════════════════

INSERT INTO doctor_schedules (org_doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
VALUES
    (v_org_doctor_id, 1, '08:00', '12:00', 30),  -- Lunes mañana
    (v_org_doctor_id, 2, '08:00', '12:00', 30),  -- Martes mañana
    (v_org_doctor_id, 3, '08:00', '12:00', 30),  -- Miércoles mañana
    (v_org_doctor_id, 4, '08:00', '12:00', 30),  -- Jueves mañana
    (v_org_doctor_id, 5, '08:00', '12:00', 30)   -- Viernes mañana
ON CONFLICT (org_doctor_id, day_of_week) WHERE is_active = true DO NOTHING;

RAISE NOTICE '✅ Horarios creados';

-- ═══════════════════════════════════════════════════════════
-- 20 TURNOS (mezcla de hoy, mañana, pasados y futuros)
-- ═══════════════════════════════════════════════════════════

-- HOY: 6 turnos (2 completados, 1 en curso, 2 confirmados, 1 pendiente)
INSERT INTO appointments (organization_id, org_doctor_id, patient_id, date, start_time, end_time, status, reason, is_first_visit)
VALUES
    (v_org_id, v_org_doctor_id, v_patient_ids[1], CURRENT_DATE, '08:00', '08:30', 'completed', 'Control de presión arterial', false),
    (v_org_id, v_org_doctor_id, v_patient_ids[2], CURRENT_DATE, '08:30', '09:00', 'completed', 'Control diabetes - hemoglobina glicosilada', false),
    (v_org_id, v_org_doctor_id, v_patient_ids[6], CURRENT_DATE, '09:00', '09:30', 'in_progress', 'Disnea progresiva, control EPOC', false),
    (v_org_id, v_org_doctor_id, v_patient_ids[3], CURRENT_DATE, '09:30', '10:00', 'confirmed', 'Cefalea recurrente desde hace 2 semanas', false),
    (v_org_id, v_org_doctor_id, v_patient_ids[5], CURRENT_DATE, '10:00', '10:30', 'confirmed', 'Dolor lumbar', false),
    (v_org_id, v_org_doctor_id, v_patient_ids[7], CURRENT_DATE, '10:30', '11:00', 'pending', 'Primera consulta - chequeo general', true);

-- MAÑANA: 5 turnos
INSERT INTO appointments (organization_id, org_doctor_id, patient_id, date, start_time, end_time, status, reason, is_first_visit)
VALUES
    (v_org_id, v_org_doctor_id, v_patient_ids[4], CURRENT_DATE + 1, '08:00', '08:30', 'confirmed', 'Control tiroides - TSH', false),
    (v_org_id, v_org_doctor_id, v_patient_ids[8], CURRENT_DATE + 1, '08:30', '09:00', 'confirmed', 'Crisis de gota - dolor en pie derecho', false),
    (v_org_id, v_org_doctor_id, v_patient_ids[9], CURRENT_DATE + 1, '09:00', '09:30', 'pending', 'Alergia estacional - rinitis', false),
    (v_org_id, v_org_doctor_id, v_patient_ids[10], CURRENT_DATE + 1, '09:30', '10:00', 'confirmed', 'Control asma - espirometría', false),
    (v_org_id, v_org_doctor_id, v_patient_ids[1], CURRENT_DATE + 1, '10:00', '10:30', 'pending', 'Seguimiento ajuste medicación HTA', false);

-- PASADO MAÑANA: 3 turnos
INSERT INTO appointments (organization_id, org_doctor_id, patient_id, date, start_time, end_time, status, reason)
VALUES
    (v_org_id, v_org_doctor_id, v_patient_ids[2], CURRENT_DATE + 2, '08:00', '08:30', 'pending', 'Resultados laboratorio'),
    (v_org_id, v_org_doctor_id, v_patient_ids[6], CURRENT_DATE + 2, '08:30', '09:00', 'confirmed', 'Seguimiento EPOC + ECG'),
    (v_org_id, v_org_doctor_id, v_patient_ids[3], CURRENT_DATE + 2, '09:00', '09:30', 'pending', 'Resultado RMN cerebral');

-- AYER: 4 turnos (completados + 1 ausente)
INSERT INTO appointments (organization_id, org_doctor_id, patient_id, date, start_time, end_time, status, reason)
VALUES
    (v_org_id, v_org_doctor_id, v_patient_ids[4], CURRENT_DATE - 1, '08:00', '08:30', 'completed', 'Control mensual tiroides'),
    (v_org_id, v_org_doctor_id, v_patient_ids[5], CURRENT_DATE - 1, '08:30', '09:00', 'completed', 'Lumbalgia aguda'),
    (v_org_id, v_org_doctor_id, v_patient_ids[9], CURRENT_DATE - 1, '09:00', '09:30', 'completed', 'Erupción cutánea'),
    (v_org_id, v_org_doctor_id, v_patient_ids[7], CURRENT_DATE - 1, '09:30', '10:00', 'no_show', 'Consulta general');

-- SEMANA PASADA: 2 turnos cancelados
INSERT INTO appointments (organization_id, org_doctor_id, patient_id, date, start_time, end_time, status, reason, cancelled_at, cancelled_by, cancelled_reason)
VALUES
    (v_org_id, v_org_doctor_id, v_patient_ids[8], CURRENT_DATE - 5, '08:00', '08:30', 'cancelled', 'Control gota', CURRENT_DATE - 6, 'patient', 'No puedo ir, estoy de viaje'),
    (v_org_id, v_org_doctor_id, v_patient_ids[10], CURRENT_DATE - 4, '09:00', '09:30', 'cancelled', 'Control asma', CURRENT_DATE - 5, 'patient', 'Reprogramar para la próxima semana');

RAISE NOTICE '✅ 20 turnos creados';

-- ═══════════════════════════════════════════════════════════
-- HISTORIAS CLÍNICAS (para los turnos completados de ayer)
-- ═══════════════════════════════════════════════════════════

-- Historia 1: Carlos Martínez - tiroides
INSERT INTO medical_records (patient_id, doctor_id, organization_id, date, chief_complaint, present_illness, vital_signs, physical_exam, diagnosis, diagnosis_code, treatment_plan, lab_orders)
VALUES (v_patient_ids[4], v_doctor_id, v_org_id, CURRENT_DATE - 1,
    'Control hipotiroidismo',
    'Paciente refiere cansancio moderado. Toma levotiroxina 75mcg en ayunas. Último TSH hace 3 meses: 5.2 mUI/L.',
    '{"bp": "120/78", "hr": 68, "temp": 36.2, "weight": 82, "height": 175}'::JSONB,
    'Tiroides no palpable. Piel y faneras normales. Sin edemas. FC regular.',
    'Hipotiroidismo en tratamiento - ajuste de dosis', 'E03.9',
    'Aumentar Levotiroxina a 88mcg. Control TSH en 6 semanas.',
    ARRAY['TSH', 'T4 libre', 'Hemograma completo']
);

-- Historia 2: Ana Pérez - lumbalgia
INSERT INTO medical_records (patient_id, doctor_id, organization_id, date, chief_complaint, present_illness, vital_signs, physical_exam, diagnosis, diagnosis_code, treatment_plan, imaging_orders)
VALUES (v_patient_ids[5], v_doctor_id, v_org_id, CURRENT_DATE - 1,
    'Dolor lumbar agudo',
    'Dolor desde hace 3 días después de levantar peso. Irradia a glúteo izquierdo. No parestesias. No pérdida de fuerza.',
    '{"bp": "125/82", "hr": 76, "temp": 36.5, "weight": 64, "height": 162}'::JSONB,
    'Contractura paravertebral izquierda. Lasègue negativo bilateral. ROT conservados. Fuerza 5/5 MMII.',
    'Lumbalgia mecánica aguda', 'M54.5',
    'Reposo relativo 48hs. Diclofenac 75mg c/12hs x 5 días. Ciclobenzaprina 10mg noche x 7 días. Kinesiología.',
    ARRAY['RX columna lumbosacra F/P']
);

-- Historia 3: Sofía Torres - dermatitis
INSERT INTO medical_records (patient_id, doctor_id, organization_id, date, chief_complaint, present_illness, vital_signs, physical_exam, diagnosis, diagnosis_code, treatment_plan)
VALUES (v_patient_ids[9], v_doctor_id, v_org_id, CURRENT_DATE - 1,
    'Erupción cutánea en brazos',
    'Lesiones eritematosas pruriginosas en ambos antebrazos desde hace 5 días. Refiere contacto con productos de limpieza sin guantes.',
    '{"bp": "110/70", "hr": 72, "temp": 36.4, "weight": 58, "height": 165}'::JSONB,
    'Lesiones eritematopapulosas en cara anterior de ambos antebrazos. No vesículas. No sobreinfección.',
    'Dermatitis de contacto irritativa', 'L24.9',
    'Evitar contacto con irritantes. Usar guantes. Betametasona crema 0.05% c/12hs x 10 días. Loratadina 10mg/día x 7 días. Derivación a dermatología si no mejora.'
);

RAISE NOTICE '✅ 3 historias clínicas creadas';

-- ═══════════════════════════════════════════════════════════
-- 5 RECETAS
-- ═══════════════════════════════════════════════════════════

-- Receta 1: María Elena - antihipertensivo (activa)
INSERT INTO prescriptions (doctor_id, patient_id, organization_id, diagnosis, diagnosis_code, expires_at)
VALUES (v_doctor_id, v_patient_ids[1], v_org_id, 'Hipertensión arterial esencial', 'I10', NOW() + INTERVAL '30 days')
RETURNING id INTO v_rx_id;
INSERT INTO prescription_items (prescription_id, medication_name, dosage, frequency, duration, quantity, sort_order)
VALUES
    (v_rx_id, 'Enalapril', '10mg', '1 comprimido cada 12 horas', '30 días', 60, 1),
    (v_rx_id, 'Amlodipina', '5mg', '1 comprimido por la mañana', '30 días', 30, 2);

-- Receta 2: Jorge - diabetes (activa)
INSERT INTO prescriptions (doctor_id, patient_id, organization_id, diagnosis, diagnosis_code, expires_at)
VALUES (v_doctor_id, v_patient_ids[2], v_org_id, 'Diabetes mellitus tipo 2', 'E11.9', NOW() + INTERVAL '30 days')
RETURNING id INTO v_rx_id;
INSERT INTO prescription_items (prescription_id, medication_name, dosage, frequency, duration, quantity, sort_order)
VALUES
    (v_rx_id, 'Metformina', '850mg', '1 comprimido con almuerzo y cena', '30 días', 60, 1),
    (v_rx_id, 'Atorvastatina', '20mg', '1 comprimido por la noche', '30 días', 30, 2),
    (v_rx_id, 'AAS', '100mg', '1 comprimido por la mañana', '30 días', 30, 3);

-- Receta 3: Ana Pérez - lumbalgia (activa, reciente)
INSERT INTO prescriptions (doctor_id, patient_id, organization_id, diagnosis, diagnosis_code, expires_at)
VALUES (v_doctor_id, v_patient_ids[5], v_org_id, 'Lumbalgia mecánica aguda', 'M54.5', NOW() + INTERVAL '7 days')
RETURNING id INTO v_rx_id;
INSERT INTO prescription_items (prescription_id, medication_name, dosage, frequency, duration, quantity, sort_order)
VALUES
    (v_rx_id, 'Diclofenac', '75mg', '1 comprimido cada 12 horas', '5 días', 10, 1),
    (v_rx_id, 'Ciclobenzaprina', '10mg', '1 comprimido antes de dormir', '7 días', 7, 2),
    (v_rx_id, 'Omeprazol', '20mg', '1 cápsula en ayunas (protector gástrico)', '5 días', 5, 3);

-- Receta 4: Roberto - EPOC (activa)
INSERT INTO prescriptions (doctor_id, patient_id, organization_id, diagnosis, diagnosis_code, expires_at)
VALUES (v_doctor_id, v_patient_ids[6], v_org_id, 'EPOC', 'J44.1', NOW() + INTERVAL '60 days')
RETURNING id INTO v_rx_id;
INSERT INTO prescription_items (prescription_id, medication_name, dosage, frequency, duration, quantity, sort_order)
VALUES
    (v_rx_id, 'Salbutamol inhalador', '100mcg', '2 puffs cada 6 horas según necesidad', '60 días', 2, 1),
    (v_rx_id, 'Tiotropio', '18mcg', '1 cápsula inhalada por la mañana', '60 días', 60, 2),
    (v_rx_id, 'Rivaroxabán', '20mg', '1 comprimido con la cena', '30 días', 30, 3);

-- Receta 5: Sofía - dermatitis (vencida)
INSERT INTO prescriptions (doctor_id, patient_id, organization_id, diagnosis, diagnosis_code, issued_at, expires_at, status)
VALUES (v_doctor_id, v_patient_ids[9], v_org_id, 'Dermatitis de contacto', 'L24.9', NOW() - INTERVAL '15 days', NOW() - INTERVAL '5 days', 'expired')
RETURNING id INTO v_rx_id;
INSERT INTO prescription_items (prescription_id, medication_name, dosage, frequency, duration, quantity, sort_order)
VALUES
    (v_rx_id, 'Betametasona crema', '0.05%', 'Aplicar en zona afectada cada 12 horas', '10 días', 1, 1),
    (v_rx_id, 'Loratadina', '10mg', '1 comprimido por la mañana', '7 días', 7, 2);

RAISE NOTICE '✅ 5 recetas con ítems creadas';

-- ═══════════════════════════════════════════════════════════
-- 4 CONVERSACIONES CON MENSAJES
-- ═══════════════════════════════════════════════════════════

-- Chat 1: María Elena (consulta sobre medicación)
INSERT INTO conversations (organization_id, doctor_id, patient_id, last_message_text, last_message_at, doctor_unread_count)
VALUES (v_org_id, v_doctor_id, v_patient_ids[1], 'Perfecto doctora, muchas gracias!', NOW() - INTERVAL '2 hours', 0)
RETURNING id INTO v_conv_id;
INSERT INTO messages (conversation_id, sender_type, sender_id, content, is_read, created_at) VALUES
    (v_conv_id, 'patient', v_patient_ids[1], 'Doctor, buenos días. Quería consultarle si puedo tomar ibuprofeno por un dolor de cabeza. Estoy tomando enalapril.', true, NOW() - INTERVAL '5 hours'),
    (v_conv_id, 'doctor', v_doctor_id, 'Hola María Elena. Sí, podés tomar ibuprofeno 400mg, pero solo de forma puntual (máximo 2-3 días). Si el dolor persiste consultame para evaluar. No es ideal combinarlo con enalapril de forma prolongada.', true, NOW() - INTERVAL '4 hours'),
    (v_conv_id, 'patient', v_patient_ids[1], 'Perfecto doctora, muchas gracias!', true, NOW() - INTERVAL '2 hours');

-- Chat 2: Jorge (resultados de laboratorio) - con mensajes sin leer
INSERT INTO conversations (organization_id, doctor_id, patient_id, last_message_text, last_message_at, doctor_unread_count)
VALUES (v_org_id, v_doctor_id, v_patient_ids[2], 'Le adjunto los resultados del laboratorio de hoy', NOW() - INTERVAL '30 minutes', 2)
RETURNING id INTO v_conv_id;
INSERT INTO messages (conversation_id, sender_type, sender_id, content, is_read, created_at) VALUES
    (v_conv_id, 'doctor', v_doctor_id, 'Jorge, te recuerdo que mañana tenés que hacerte los análisis en ayunas. Glucemia, HbA1c, perfil lipídico y función renal.', true, NOW() - INTERVAL '1 day'),
    (v_conv_id, 'patient', v_patient_ids[2], 'Sí doctor, ya tengo turno a las 7am en el laboratorio de la clínica.', true, NOW() - INTERVAL '23 hours'),
    (v_conv_id, 'patient', v_patient_ids[2], 'Doctor, ya me hice los análisis', false, NOW() - INTERVAL '35 minutes'),
    (v_conv_id, 'patient', v_patient_ids[2], 'Le adjunto los resultados del laboratorio de hoy', false, NOW() - INTERVAL '30 minutes');

-- Chat 3: Roberto (urgencia EPOC)
INSERT INTO conversations (organization_id, doctor_id, patient_id, last_message_text, last_message_at, doctor_unread_count)
VALUES (v_org_id, v_doctor_id, v_patient_ids[6], 'Gracias doctor, ya estoy mejor con el salbutamol extra', NOW() - INTERVAL '1 day', 0)
RETURNING id INTO v_conv_id;
INSERT INTO messages (conversation_id, sender_type, sender_id, content, is_read, created_at) VALUES
    (v_conv_id, 'patient', v_patient_ids[6], 'Doctor disculpe la molestia, estoy con mucha falta de aire hoy, me puse el salbutamol pero no me alivia del todo', true, NOW() - INTERVAL '2 days'),
    (v_conv_id, 'doctor', v_doctor_id, 'Roberto, ¿cuántos puffs te pusiste? ¿Tenés fiebre o expectoración con color? Si la disnea no mejora con 4 puffs cada 4hs, andá a la guardia.', true, NOW() - INTERVAL '2 days' + INTERVAL '20 minutes'),
    (v_conv_id, 'patient', v_patient_ids[6], 'Me puse 2. No tengo fiebre pero sí un poco de flema amarillenta.', true, NOW() - INTERVAL '2 days' + INTERVAL '30 minutes'),
    (v_conv_id, 'doctor', v_doctor_id, 'Ponete 4 puffs ahora y repetí en 4hs. La flema amarillenta puede indicar sobreinfección. Venite mañana primera hora o andá a la guardia si empeorás. Te voy a dejar antibiótico por las dudas.', true, NOW() - INTERVAL '2 days' + INTERVAL '40 minutes'),
    (v_conv_id, 'patient', v_patient_ids[6], 'Gracias doctor, ya estoy mejor con el salbutamol extra', true, NOW() - INTERVAL '1 day');

-- Chat 4: Valentina (primera consulta) - sin leer
INSERT INTO conversations (organization_id, doctor_id, patient_id, last_message_text, last_message_at, doctor_unread_count)
VALUES (v_org_id, v_doctor_id, v_patient_ids[7], 'Hola doctor, le escribo porque saqué turno para mañana. Quería saber si tengo que llevar estudios previos?', NOW() - INTERVAL '3 hours', 1)
RETURNING id INTO v_conv_id;
INSERT INTO messages (conversation_id, sender_type, sender_id, content, is_read, created_at) VALUES
    (v_conv_id, 'patient', v_patient_ids[7], 'Hola doctor, le escribo porque saqué turno para mañana. Quería saber si tengo que llevar estudios previos?', false, NOW() - INTERVAL '3 hours');

RAISE NOTICE '✅ 4 conversaciones con mensajes creadas';
RAISE NOTICE '══════════════════════════════════════════';
RAISE NOTICE '🏥 Seed completo:';
RAISE NOTICE '   • 10 pacientes';
RAISE NOTICE '   • 20 turnos (6 hoy, 5 mañana, 3 pasado, 4 ayer, 2 cancelados)';
RAISE NOTICE '   • 3 historias clínicas';
RAISE NOTICE '   • 5 recetas (4 activas, 1 vencida)';
RAISE NOTICE '   • 4 conversaciones (3 mensajes sin leer)';
RAISE NOTICE '   • Horarios Lun-Vie 8:00 a 12:00';
RAISE NOTICE '══════════════════════════════════════════';

END $$;
