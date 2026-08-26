#!/bin/bash
# ============================================================
# MediClick — Escenario multi-consultorio
#
# Crea un segundo consultorio con el mismo médico y le pone
# turnos en horarios que se pisan con los del primero, para
# poder probar la detección de conflictos cross-organización.
#
#   curl -sSL https://raw.githubusercontent.com/jacquet33/mediclick-api/main/scripts/seed-multicentro.sh | bash
#
# Limpiar: bash seed-multicentro.sh --limpiar
# ============================================================
set -e

DB="docker exec -i mediclick-db psql -U mediclick -d mediclick"
EMAIL="${MEDICLICK_EMAIL:-alejandro@mediclick.app}"

if [ "$1" == "--limpiar" ]; then
  echo "Borrando el segundo consultorio..."
  $DB <<'SQL'
DELETE FROM appointments WHERE organization_id IN (
  SELECT id FROM organizations WHERE name = 'Centro Médico Paraná'
);
DELETE FROM patients WHERE organization_id IN (
  SELECT id FROM organizations WHERE name = 'Centro Médico Paraná'
);
DELETE FROM doctor_schedules WHERE org_doctor_id IN (
  SELECT od.id FROM organization_doctors od
  JOIN organizations o ON o.id = od.organization_id
  WHERE o.name = 'Centro Médico Paraná'
);
DELETE FROM organization_doctors WHERE organization_id IN (
  SELECT id FROM organizations WHERE name = 'Centro Médico Paraná'
);
DELETE FROM organizations WHERE name = 'Centro Médico Paraná';
SQL
  echo "Listo."
  exit 0
fi

echo "════════════════════════════════════════════════"
echo " Escenario multi-consultorio"
echo "════════════════════════════════════════════════"
echo ""

$DB <<SQL
DO \$\$
DECLARE
  v_doctor   UUID;
  v_org1     UUID;
  v_org2     UUID;
  v_orgdoc1  UUID;
  v_orgdoc2  UUID;
  v_patient  UUID;
  v_tomorrow DATE := CURRENT_DATE + 1;
BEGIN
  SELECT d.id INTO v_doctor FROM doctors d WHERE d.email = '${EMAIL}';
  IF v_doctor IS NULL THEN
    RAISE EXCEPTION 'No encontré al doctor ${EMAIL}';
  END IF;

  -- Consultorio original
  SELECT od.organization_id, od.id INTO v_org1, v_orgdoc1
  FROM organization_doctors od
  WHERE od.doctor_id = v_doctor AND od.is_active
  ORDER BY od.joined_at LIMIT 1;

  RAISE NOTICE 'Consultorio 1: %', (SELECT name FROM organizations WHERE id = v_org1);

  -- ─── Segundo consultorio ────────────────────────────────
  SELECT id INTO v_org2 FROM organizations WHERE name = 'Centro Médico Paraná';

  IF v_org2 IS NULL THEN
    INSERT INTO organizations (name, type, address, city, province, phone, default_slot_duration)
    VALUES ('Centro Médico Paraná', 'centro_medico',
            'Av. Ramírez 1250', 'Paraná', 'Entre Ríos', '343-4231100', 30)
    RETURNING id INTO v_org2;
  END IF;

  -- El mismo médico, ahora en dos lugares
  INSERT INTO organization_doctors (organization_id, doctor_id, role, consultation_fee, room_number)
  VALUES (v_org2, v_doctor, 'doctor', 18000, 'Consultorio 4')
  ON CONFLICT (organization_id, doctor_id) DO UPDATE SET is_active = true
  RETURNING id INTO v_orgdoc2;

  IF v_orgdoc2 IS NULL THEN
    SELECT id INTO v_orgdoc2 FROM organization_doctors
    WHERE organization_id = v_org2 AND doctor_id = v_doctor;
  END IF;

  RAISE NOTICE 'Consultorio 2: Centro Médico Paraná';

  -- Atiende de tarde acá
  INSERT INTO doctor_schedules (org_doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
  SELECT v_orgdoc2, d, '14:00'::time, '20:00'::time, 30
  FROM generate_series(1,5) d
  ON CONFLICT (org_doctor_id, day_of_week) WHERE is_active DO NOTHING;

  -- ─── Pacientes del segundo consultorio ──────────────────
  DELETE FROM patients WHERE organization_id = v_org2 AND notes = 'demo-multi';

  INSERT INTO patients (organization_id, first_name, last_name, dni, phone,
                        date_of_birth, gender, insurance_provider, insurance_number, notes)
  VALUES
    (v_org2, 'Roberto', 'Gómez', '20334455', '343-4445566',
     '1968-02-14', 'male', 'IOSPER', '4512-2201-07', 'demo-multi'),
    (v_org2, 'Lucía', 'Fernández', '38221100', '343-5556677',
     '1995-09-03', 'female', 'OSDE', '62-9988776-02', 'demo-multi');

  -- ─── Turno en el segundo consultorio ────────────────────
  -- Mañana a las 15:00. Este es el que va a generar el conflicto.
  SELECT id INTO v_patient FROM patients
  WHERE organization_id = v_org2 AND dni = '20334455';

  DELETE FROM appointments
  WHERE org_doctor_id = v_orgdoc2 AND date = v_tomorrow;

  INSERT INTO appointments (organization_id, org_doctor_id, patient_id, date,
                            start_time, end_time, status, reason, room_number)
  VALUES (v_org2, v_orgdoc2, v_patient, v_tomorrow,
          '15:00', '15:30', 'confirmed', 'Control cardiológico', 'Consultorio 4');

  RAISE NOTICE '';
  RAISE NOTICE 'Turno cargado en Centro Médico Paraná:';
  RAISE NOTICE '  % a las 15:00 — Roberto Gómez', v_tomorrow;
END \$\$;
SQL

echo ""
echo "════════════════════════════════════════════════"
echo " Cómo probar el bloqueo"
echo "════════════════════════════════════════════════"
echo ""
echo "El Dr. tiene turno MAÑANA a las 15:00 en Centro Médico Paraná."
echo ""
echo "Desde la app, parado en el OTRO consultorio, intentá crear un"
echo "turno mañana a las 15:00 (o 14:45, o 15:15 — cualquier horario"
echo "que se pise)."
echo ""
echo "Tiene que rechazarlo y decirte dónde está el conflicto."
echo ""
echo "Para verlo por API:"
echo ""

# Show the ready-to-run curl
$DB -t <<SQL | sed 's/^ *//' | grep -v '^$'
SELECT
  'TOKEN=\$(curl -s -X POST http://localhost:3100/api/v1/auth/login -H "Content-Type: application/json" -d ''{"email":"${EMAIL}","password":"MediClick2026"}'' | python3 -c "import json,sys; print(json.load(sys.stdin)[''accessToken''])")'
UNION ALL SELECT ''
UNION ALL SELECT
  'curl -s "http://localhost:3100/api/v1/appointments/check-conflict?doctor_id=' || d.id ||
  '&date=' || (CURRENT_DATE + 1) ||
  '&start_time=15:00&end_time=15:30" -H "Authorization: Bearer \$TOKEN" | python3 -m json.tool'
FROM doctors d WHERE d.email = '${EMAIL}';
SQL

echo ""
