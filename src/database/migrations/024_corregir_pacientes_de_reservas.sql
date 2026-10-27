-- 024: turnos reservados online que quedaron a nombre de otro paciente (se reutilizaba el paciente
-- por teléfono aunque el nombre fuera distinto). Para cada reserva cuyo nombre no coincide con el
-- paciente vinculado (y sin DNI en común) se crea el paciente correcto y se reasigna el turno.
DO $$
DECLARE
  r RECORD;
  nuevo UUID;
BEGIN
  FOR r IN
    SELECT br.id AS booking_id, br.appointment_id, br.organization_id, br.first_name, br.last_name,
           br.dni, br.email, br.phone, br.date_of_birth, br.insurance_provider, br.insurance_number
    FROM booking_requests br
    JOIN appointments a ON a.id = br.appointment_id
    JOIN patients p ON p.id = a.patient_id
    WHERE COALESCE(br.first_name, '') <> ''
      AND (lower(unaccent_simple(trim(p.first_name))) <> lower(unaccent_simple(trim(br.first_name)))
           OR lower(unaccent_simple(trim(p.last_name))) <> lower(unaccent_simple(trim(COALESCE(br.last_name, '')))))
      AND NOT (COALESCE(br.dni, '') <> '' AND regexp_replace(COALESCE(p.dni, ''), '\D', '', 'g') = regexp_replace(br.dni, '\D', '', 'g'))
  LOOP
    -- ¿Ya existe ese paciente (mismo nombre y teléfono, o mismo DNI)?
    SELECT id INTO nuevo FROM patients
    WHERE organization_id = r.organization_id
      AND ((COALESCE(r.dni, '') <> '' AND regexp_replace(COALESCE(dni, ''), '\D', '', 'g') = regexp_replace(r.dni, '\D', '', 'g'))
           OR (phone = r.phone
               AND lower(unaccent_simple(trim(first_name))) = lower(unaccent_simple(trim(r.first_name)))
               AND lower(unaccent_simple(trim(last_name))) = lower(unaccent_simple(trim(COALESCE(r.last_name, ''))))))
    ORDER BY created_at LIMIT 1;

    IF nuevo IS NULL THEN
      INSERT INTO patients (organization_id, first_name, last_name, dni, email, phone, date_of_birth, insurance_provider, insurance_number)
      VALUES (r.organization_id, trim(r.first_name), trim(COALESCE(r.last_name, '')), NULLIF(r.dni, ''), NULLIF(r.email, ''), r.phone,
              r.date_of_birth, NULLIF(r.insurance_provider, ''), NULLIF(r.insurance_number, ''))
      RETURNING id INTO nuevo;
    END IF;

    UPDATE appointments SET patient_id = nuevo WHERE id = r.appointment_id;
    UPDATE booking_requests SET patient_id = nuevo WHERE id = r.booking_id;
    nuevo := NULL;
  END LOOP;
END $$;
