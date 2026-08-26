#!/bin/bash
# ============================================================
# MediClick — Datos de prueba
#
# Carga un escenario completo para recorrer el flujo de punta a
# punta: pacientes con obra social, turnos completados del mes
# pasado, un nomenclador con casos que la auditoría tiene que
# detectar, y algunas recetas.
#
# Uso en el VPS:
#   curl -sSL https://raw.githubusercontent.com/jacquet33/mediclick-api/main/scripts/seed-demo.sh | bash
#
# Es idempotente: se puede correr varias veces.
# Para borrar todo: bash seed-demo.sh --limpiar
# ============================================================
set -e

DB="docker exec -i mediclick-db psql -U mediclick -d mediclick"
EMAIL="${MEDICLICK_EMAIL:-alejandro@mediclick.app}"

if [ "$1" == "--limpiar" ]; then
  echo "Borrando datos de prueba..."
  $DB <<'SQL'
DELETE FROM billing_items WHERE batch_id IN (
  SELECT id FROM billing_batches WHERE organization_id IN (
    SELECT organization_id FROM organization_doctors od
    JOIN doctors d ON d.id = od.doctor_id WHERE d.email = 'alejandro@mediclick.app'
  )
);
DELETE FROM billing_batches WHERE organization_id IN (
  SELECT organization_id FROM organization_doctors od
  JOIN doctors d ON d.id = od.doctor_id WHERE d.email = 'alejandro@mediclick.app'
);
DELETE FROM nomenclator_items WHERE nomenclator_id IN (
  SELECT id FROM nomenclators WHERE source = 'demo'
);
DELETE FROM nomenclators WHERE source = 'demo';
DELETE FROM prescription_items WHERE prescription_id IN (
  SELECT id FROM prescriptions WHERE notes = 'demo'
);
DELETE FROM prescriptions WHERE notes = 'demo';
DELETE FROM medical_records WHERE private_notes = 'demo';
DELETE FROM appointments WHERE notes = 'demo';
DELETE FROM patients WHERE notes = 'demo';
SQL
  echo "Listo."
  exit 0
fi

echo "════════════════════════════════════════"
echo " Cargando datos de prueba"
echo "════════════════════════════════════════"
echo ""

$DB <<SQL
DO \$\$
DECLARE
  v_org        UUID;
  v_doctor     UUID;
  v_orgdoc     UUID;
  v_iosper     UUID;
  v_osde       UUID;
  v_nom        UUID;
  v_patient    UUID;
  v_appt       UUID;
  v_last_month DATE := (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::date;
BEGIN
  -- ─── Contexto ───────────────────────────────────────────
  SELECT d.id, od.organization_id, od.id
    INTO v_doctor, v_org, v_orgdoc
  FROM doctors d
  JOIN organization_doctors od ON od.doctor_id = d.id AND od.is_active
  WHERE d.email = '${EMAIL}'
  LIMIT 1;

  IF v_doctor IS NULL THEN
    RAISE EXCEPTION 'No encontré al doctor ${EMAIL}. Registrate primero.';
  END IF;

  SELECT id INTO v_iosper FROM insurers WHERE short_name = 'IOSPER';
  SELECT id INTO v_osde   FROM insurers WHERE short_name = 'OSDE';

  IF v_iosper IS NULL THEN
    RAISE EXCEPTION 'Falta el padrón. Importalo primero.';
  END IF;

  RAISE NOTICE 'Organización: %', v_org;

  -- ─── Horario de atención ────────────────────────────────
  INSERT INTO doctor_schedules (org_doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
  SELECT v_orgdoc, d, '08:00'::time, '16:00'::time, 30
  FROM generate_series(1,5) d
  ON CONFLICT DO NOTHING;

  -- ─── Nomenclador IOSPER ─────────────────────────────────
  DELETE FROM nomenclators WHERE insurer_id = v_iosper AND source = 'demo';

  INSERT INTO nomenclators (name, insurer_id, organization_id, source, valid_from, unit_value)
  VALUES ('Nomenclador IOSPER (demo)', v_iosper, v_org, 'demo',
          (v_last_month - INTERVAL '2 months')::date, NULL)
  RETURNING id INTO v_nom;

  INSERT INTO nomenclator_items
    (nomenclator_id, code, description, specialty, amount,
     requires_authorization, requires_diagnosis, max_per_period, period_days,
     min_age, max_age, coinsurance)
  VALUES
    -- Consultas
    (v_nom, '420101', 'Consulta en consultorio', 'Clínica médica', 8500, false, true, NULL, NULL, NULL, NULL, NULL),
    (v_nom, '420102', 'Consulta domiciliaria', 'Clínica médica', 14000, false, true, NULL, NULL, NULL, NULL, NULL),
    (v_nom, '420110', 'Consulta de urgencia', 'Clínica médica', 12000, false, true, NULL, NULL, NULL, NULL, 2500),
    -- Prácticas
    (v_nom, '170101', 'Electrocardiograma', 'Cardiología', 9800, false, true, NULL, NULL, NULL, NULL, NULL),
    (v_nom, '170201', 'Ergometría', 'Cardiología', 32000, true, true, NULL, NULL, NULL, NULL, NULL),
    (v_nom, '340101', 'Ecografía abdominal', 'Diagnóstico por imágenes', 21000, true, true, NULL, NULL, NULL, NULL, NULL),
    -- Con topes y restricciones, para que la auditoría tenga qué encontrar
    (v_nom, '420301', 'Control de salud anual', 'Clínica médica', 9500, false, true, 1, 365, NULL, NULL, NULL),
    (v_nom, '480101', 'Papanicolaou', 'Ginecología', 11000, false, true, 1, 365, 18, NULL, NULL),
    (v_nom, '490101', 'Control pediátrico', 'Pediatría', 8000, false, true, NULL, NULL, 0, 15, NULL),
    (v_nom, '999999', 'Código sin valor cargado', 'Otros', NULL, false, true, NULL, NULL, NULL, NULL, NULL);

  RAISE NOTICE 'Nomenclador: 10 códigos';

  -- ─── Pacientes ──────────────────────────────────────────
  DELETE FROM patients WHERE organization_id = v_org AND notes = 'demo';

  -- 1. Todo correcto
  INSERT INTO patients (organization_id, first_name, last_name, dni, phone, email,
                        date_of_birth, gender, blood_type, insurance_provider,
                        insurance_number, insurance_plan, chronic_conditions, allergies, notes)
  VALUES (v_org, 'María', 'López', '28456789', '343-4567890', 'mlopez@mail.com',
          '1959-03-15', 'female', 'A+', 'IOSPER', '4512-3378-01', 'Básico',
          ARRAY['Hipertensión','Hipotiroidismo'], ARRAY['Penicilina'], 'demo');

  -- 2. Sin número de afiliado — la auditoría lo va a bloquear
  INSERT INTO patients (organization_id, first_name, last_name, dni, phone,
                        date_of_birth, gender, insurance_provider, notes)
  VALUES (v_org, 'Juan', 'Pérez', '35123456', '343-5551234',
          '1992-07-22', 'male', 'IOSPER', 'demo');

  -- 3. Correcto
  INSERT INTO patients (organization_id, first_name, last_name, dni, phone, email,
                        date_of_birth, gender, blood_type, insurance_provider,
                        insurance_number, insurance_plan, chronic_conditions, notes)
  VALUES (v_org, 'Ana', 'Martínez', '30987654', '343-4441122', 'amartinez@mail.com',
          '1974-11-08', 'female', 'O+', 'IOSPER', '4512-9981-03', 'Básico',
          ARRAY['Diabetes tipo 2'], 'demo');

  -- 4. Menor — para la restricción de edad del PAP
  INSERT INTO patients (organization_id, first_name, last_name, dni, phone,
                        date_of_birth, gender, insurance_provider, insurance_number, notes)
  VALUES (v_org, 'Sofía', 'Benítez', '52334455', '343-6667788',
          (CURRENT_DATE - INTERVAL '12 years')::date, 'female', 'IOSPER', '4512-7734-09', 'demo');

  -- 5. OSDE, para tener dos financiadores
  INSERT INTO patients (organization_id, first_name, last_name, dni, phone, email,
                        date_of_birth, gender, insurance_provider, insurance_number,
                        insurance_plan, notes)
  VALUES (v_org, 'Carlos', 'Ruiz', '33654321', '343-8889900', 'cruiz@mail.com',
          '1985-05-30', 'male', 'OSDE', '62-1234567-01', '210', 'demo');

  RAISE NOTICE 'Pacientes: 5';

  -- ─── Turnos completados del mes pasado ──────────────────
  -- María: consulta normal, con diagnóstico
  SELECT id INTO v_patient FROM patients WHERE organization_id = v_org AND dni = '28456789';
  INSERT INTO appointments (organization_id, org_doctor_id, patient_id, date, start_time, end_time,
                            status, reason, notes)
  VALUES (v_org, v_orgdoc, v_patient, v_last_month + 4, '09:00', '09:30',
          'completed', 'Control de hipertensión', 'demo')
  RETURNING id INTO v_appt;

  INSERT INTO medical_records (patient_id, doctor_id, organization_id, appointment_id,
                               date, chief_complaint, diagnosis, diagnosis_code, private_notes)
  VALUES (v_patient, v_doctor, v_org, v_appt, v_last_month + 4,
          'Control mensual', 'Hipertensión arterial esencial', 'I10', 'demo');

  -- Juan: sin afiliado Y sin diagnóstico — dos bloqueos
  SELECT id INTO v_patient FROM patients WHERE organization_id = v_org AND dni = '35123456';
  INSERT INTO appointments (organization_id, org_doctor_id, patient_id, date, start_time, end_time,
                            status, reason, is_first_visit, notes)
  VALUES (v_org, v_orgdoc, v_patient, v_last_month + 5, '10:00', '10:30',
          'completed', 'Primera consulta', true, 'demo');

  -- Ana: dos consultas, con diagnóstico
  SELECT id INTO v_patient FROM patients WHERE organization_id = v_org AND dni = '30987654';
  INSERT INTO appointments (organization_id, org_doctor_id, patient_id, date, start_time, end_time,
                            status, reason, notes)
  VALUES (v_org, v_orgdoc, v_patient, v_last_month + 6, '11:00', '11:30',
          'completed', 'Control de diabetes', 'demo')
  RETURNING id INTO v_appt;

  INSERT INTO medical_records (patient_id, doctor_id, organization_id, appointment_id,
                               date, chief_complaint, diagnosis, diagnosis_code, private_notes)
  VALUES (v_patient, v_doctor, v_org, v_appt, v_last_month + 6,
          'Control glucemia', 'Diabetes mellitus tipo 2', 'E11', 'demo');

  INSERT INTO appointments (organization_id, org_doctor_id, patient_id, date, start_time, end_time,
                            status, reason, notes)
  VALUES (v_org, v_orgdoc, v_patient, v_last_month + 20, '11:00', '11:30',
          'completed', 'Seguimiento', 'demo')
  RETURNING id INTO v_appt;

  INSERT INTO medical_records (patient_id, doctor_id, organization_id, appointment_id,
                               date, chief_complaint, diagnosis, diagnosis_code, private_notes)
  VALUES (v_patient, v_doctor, v_org, v_appt, v_last_month + 20,
          'Seguimiento', 'Diabetes mellitus tipo 2', 'E11', 'demo');

  -- Sofía: menor, con diagnóstico
  SELECT id INTO v_patient FROM patients WHERE organization_id = v_org AND dni = '52334455';
  INSERT INTO appointments (organization_id, org_doctor_id, patient_id, date, start_time, end_time,
                            status, reason, notes)
  VALUES (v_org, v_orgdoc, v_patient, v_last_month + 7, '15:00', '15:30',
          'completed', 'Control pediátrico', 'demo')
  RETURNING id INTO v_appt;

  INSERT INTO medical_records (patient_id, doctor_id, organization_id, appointment_id,
                               date, chief_complaint, diagnosis, diagnosis_code, private_notes)
  VALUES (v_patient, v_doctor, v_org, v_appt, v_last_month + 7,
          'Control de crecimiento', 'Control de salud del niño', 'Z00.1', 'demo');

  -- Turnos futuros, para que la agenda no esté vacía
  SELECT id INTO v_patient FROM patients WHERE organization_id = v_org AND dni = '28456789';
  INSERT INTO appointments (organization_id, org_doctor_id, patient_id, date, start_time, end_time,
                            status, reason, notes)
  VALUES (v_org, v_orgdoc, v_patient, CURRENT_DATE, '09:30', '10:00',
          'confirmed', 'Control mensual', 'demo');

  SELECT id INTO v_patient FROM patients WHERE organization_id = v_org AND dni = '30987654';
  INSERT INTO appointments (organization_id, org_doctor_id, patient_id, date, start_time, end_time,
                            status, reason, notes)
  VALUES (v_org, v_orgdoc, v_patient, CURRENT_DATE, '10:30', '11:00',
          'pending', 'Seguimiento diabetes', 'demo');

  SELECT id INTO v_patient FROM patients WHERE organization_id = v_org AND dni = '33654321';
  INSERT INTO appointments (organization_id, org_doctor_id, patient_id, date, start_time, end_time,
                            status, reason, notes)
  VALUES (v_org, v_orgdoc, v_patient, CURRENT_DATE + 1, '08:30', '09:00',
          'confirmed', 'Chequeo general', 'demo');

  RAISE NOTICE 'Turnos: 5 completados del mes pasado, 3 próximos';

  -- ─── Recetas ────────────────────────────────────────────
  SELECT id INTO v_patient FROM patients WHERE organization_id = v_org AND dni = '28456789';
  INSERT INTO prescriptions (doctor_id, patient_id, organization_id, diagnosis, diagnosis_code,
                             expires_at, notes)
  VALUES (v_doctor, v_patient, v_org, 'Hipertensión arterial', 'I10',
          CURRENT_DATE + 30, 'demo')
  RETURNING id INTO v_appt;

  INSERT INTO prescription_items (prescription_id, medication_name, dosage, frequency, duration)
  VALUES (v_appt, 'Enalapril', '10mg', '1 comprimido cada 12 hs', '30 días');

  SELECT id INTO v_patient FROM patients WHERE organization_id = v_org AND dni = '30987654';
  INSERT INTO prescriptions (doctor_id, patient_id, organization_id, diagnosis, diagnosis_code,
                             expires_at, notes)
  VALUES (v_doctor, v_patient, v_org, 'Diabetes mellitus tipo 2', 'E11',
          CURRENT_DATE + 60, 'demo')
  RETURNING id INTO v_appt;

  INSERT INTO prescription_items (prescription_id, medication_name, dosage, frequency, duration)
  VALUES (v_appt, 'Metformina', '850mg', '1 comprimido con desayuno y cena', '60 días');

  RAISE NOTICE 'Recetas: 2';

  -- ─── Configuración de reservas ──────────────────────────
  INSERT INTO booking_settings (org_doctor_id, is_enabled, public_slug, booking_mode,
                                consultation_fee, max_days_in_advance, min_hours_in_advance,
                                welcome_message)
  VALUES (v_orgdoc, true, 'dr-jacquet-demo', 'approval', 15000, 45, 3,
          'Reservá tu turno online. Te confirmamos dentro de las 24 hs.')
  ON CONFLICT (org_doctor_id) DO UPDATE SET is_enabled = true;

  RAISE NOTICE 'Reservas online activadas';
END \$\$;
SQL

echo ""
echo "════════════════════════════════════════"
echo " Resumen"
echo "════════════════════════════════════════"

$DB -t <<SQL
SELECT '  Pacientes:        ' || COUNT(*) FROM patients WHERE notes = 'demo';
SELECT '  Turnos:           ' || COUNT(*) FROM appointments WHERE notes = 'demo';
SELECT '  Completados:      ' || COUNT(*) FROM appointments WHERE notes = 'demo' AND status = 'completed';
SELECT '  Historias:        ' || COUNT(*) FROM medical_records WHERE private_notes = 'demo';
SELECT '  Recetas:          ' || COUNT(*) FROM prescriptions WHERE notes = 'demo';
SELECT '  Códigos:          ' || COUNT(*) FROM nomenclator_items ni
  JOIN nomenclators n ON n.id = ni.nomenclator_id WHERE n.source = 'demo';
SQL

echo ""
echo "Probá ahora:"
echo "  1. Abrí la app, cerrá sesión y volvé a entrar"
echo "  2. Más → Facturación → + → IOSPER → mes pasado"
echo "  3. Mirá el resultado de la auditoría"
echo ""
echo "Deberían aparecer líneas bloqueadas de Juan Pérez"
echo "(sin afiliado y sin diagnóstico)."
echo ""
