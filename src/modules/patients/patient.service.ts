import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export interface CreatePatientDto {
  firstName: string;
  lastName: string;
  dni?: string;
  email?: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  bloodType?: string;
  address?: string;
  city?: string;
  province?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  insuranceProvider?: string;
  insuranceNumber?: string;
  insurancePlan?: string;
  cuil?: string;
  primaryDoctorId?: string;
  allergies?: string[];
  chronicConditions?: string[];
  currentMedications?: string[];
  notes?: string;
}

@Injectable()
export class PatientService {
  private readonly logger = new Logger(PatientService.name);

  constructor(private db: DatabaseService) {}

  async findAll(orgId: string, query?: { search?: string; updatedSince?: string; page?: number; limit?: number }) {
    const page = query?.page || 1;
    const limit = Math.min(query?.limit || 50, 100);
    const offset = (page - 1) * limit;
    let whereClause = 'WHERE p.organization_id = $1 AND p.is_active = true';
    const params: any[] = [orgId];
    let idx = 2;

    if (query?.search) {
      whereClause += ` AND (p.first_name ILIKE $${idx} OR p.last_name ILIKE $${idx} OR p.dni ILIKE $${idx})`;
      params.push(`%${query.search}%`);
      idx++;
    }

    if (query?.updatedSince) {
      whereClause += ` AND p.updated_at > $${idx}::timestamptz`;
      params.push(query.updatedSince);
      idx++;
    }

    const countResult = await this.db.queryOne(`SELECT COUNT(*) as total FROM patients p ${whereClause}`, params);

    params.push(limit, offset);
    const patients = await this.db.queryMany(
      `SELECT p.*, d.first_name || ' ' || d.last_name AS primary_doctor_name
       FROM patients p
       LEFT JOIN doctors d ON d.id = p.primary_doctor_id
       ${whereClause}
       ORDER BY p.last_name, p.first_name
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params,
    );

    return { data: patients, total: parseInt(countResult.total), page, limit };
  }

  async findById(orgId: string, id: string) {
    const patient = await this.db.queryOne(
      `SELECT p.*, d.first_name || ' ' || d.last_name AS primary_doctor_name
       FROM patients p
       LEFT JOIN doctors d ON d.id = p.primary_doctor_id
       WHERE p.id = $1 AND p.organization_id = $2 AND p.is_active = true`,
      [id, orgId],
    );
    if (!patient) throw new NotFoundException('Paciente no encontrado');
    return patient;
  }

  async create(orgId: string, dto: any) {
    // Accept both camelCase and snake_case from iOS/web
    const firstName = dto.firstName || dto.first_name;
    const lastName = dto.lastName || dto.last_name;
    
    if (!firstName || !lastName) {
      throw new Error('firstName and lastName are required');
    }
    
    const patient = await this.db.queryOne(
      `INSERT INTO patients (
        organization_id, first_name, last_name, dni, cuil, email, phone,
        date_of_birth, address, city, province,
        insurance_provider, insurance_number, insurance_plan,
        primary_doctor_id, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *`,
      [
        orgId, firstName, lastName,
        dto.dni || null, dto.cuil || (dto as any).cuil || null,
        dto.email || null, dto.phone || null,
        dto.dateOfBirth || dto.date_of_birth || null,
        dto.address || null, dto.city || null, dto.province || null,
        dto.insuranceProvider || dto.insurance_provider || null,
        dto.insuranceNumber || dto.insurance_number || null,
        dto.insurancePlan || dto.insurance_plan || null,
        dto.primaryDoctorId || dto.primary_doctor_id || null,
        dto.notes || null,
      ],
    );
    this.logger.log(`Patient created: ${firstName} ${lastName} in org ${orgId}`);
    return patient;
  }

  async update(orgId: string, id: string, dto: Partial<CreatePatientDto>) {
    await this.findById(orgId, id);

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    const mapping: Record<string, string> = {
      firstName: 'first_name', lastName: 'last_name', dni: 'dni', cuil: 'cuil',
      email: 'email', phone: 'phone', dateOfBirth: 'date_of_birth',
      gender: 'gender', bloodType: 'blood_type', address: 'address',
      city: 'city', province: 'province',
      emergencyContactName: 'emergency_contact_name',
      emergencyContactPhone: 'emergency_contact_phone',
      insuranceProvider: 'insurance_provider',
      insuranceNumber: 'insurance_number', insurancePlan: 'insurance_plan',
      primaryDoctorId: 'primary_doctor_id', allergies: 'allergies',
      chronicConditions: 'chronic_conditions',
      currentMedications: 'current_medications', notes: 'notes',
    };

    for (const [key, col] of Object.entries(mapping)) {
      if (dto[key] !== undefined) {
        fields.push(`${col} = $${idx}`);
        values.push(dto[key]);
        idx++;
      }
    }

    if (fields.length === 0) return this.findById(orgId, id);

    values.push(id, orgId);
    return this.db.queryOne(
      `UPDATE patients SET ${fields.join(', ')} WHERE id = $${idx} AND organization_id = $${idx + 1} RETURNING *`,
      values,
    );
  }

  async delete(orgId: string, id: string) {
    await this.findById(orgId, id);
    await this.db.query(
      `UPDATE patients SET is_active = false WHERE id = $1 AND organization_id = $2`,
      [id, orgId],
    );
    return { message: 'Paciente desactivado' };
  }

  /**
   * Obras sociales con las que el consultorio realmente trabaja.
   *
   * Sale de lo que hay cargado en los pacientes, matcheado contra
   * el padrón. Es lo que se ofrece al armar un lote — no tiene
   * sentido mostrar las 300 si el médico atiende 6.
   */
  async insurersInUse(orgId: string) {
    return this.db.queryMany(
      `SELECT DISTINCT i.id, i.name, i.short_name, i.kind, i.province,
              COUNT(p.id) AS patient_count
       FROM patients p
       JOIN insurers i ON (
         LOWER(p.insurance_provider) = LOWER(i.name)
         OR LOWER(p.insurance_provider) = LOWER(i.short_name)
         OR p.insurance_provider = ANY(i.aliases)
       )
       WHERE p.organization_id = $1
         AND p.is_active
         AND p.insurance_provider IS NOT NULL
       GROUP BY i.id
       ORDER BY COUNT(p.id) DESC, i.name`,
      [orgId],
    );
  }

  async getTimeline(orgId: string, patientId: string) {
    await this.findById(orgId, patientId);

    const [appointments, records, prescriptions] = await Promise.all([
      this.db.queryMany(
        `SELECT id, date, start_time, end_time, status, reason, 'appointment' as type
         FROM appointments WHERE patient_id = $1 AND organization_id = $2
         ORDER BY date DESC LIMIT 50`,
        [patientId, orgId],
      ),
      this.db.queryMany(
        `SELECT id, date, chief_complaint, diagnosis, diagnosis_code, 'record' as type
         FROM medical_records WHERE patient_id = $1 AND organization_id = $2
         ORDER BY date DESC LIMIT 50`,
        [patientId, orgId],
      ),
      this.db.queryMany(
        `SELECT id, issued_at as date, diagnosis, status, verification_code, 'prescription' as type
         FROM prescriptions WHERE patient_id = $1 AND organization_id = $2
         ORDER BY issued_at DESC LIMIT 50`,
        [patientId, orgId],
      ),
    ]);

    const timeline = [...appointments, ...records, ...prescriptions]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return timeline;
  }

  /**
   * Ficha completa del paciente: datos personales, foto, cobertura, turnos y resumen.
   * Con clinico=false (secretaría) no incluye historias clínicas ni recetas.
   */
  async getFicha(orgId: string, patientId: string, clinico: boolean) {
    const patient = await this.findById(orgId, patientId);
    const q = (sql: string, p: any[] = [patientId, orgId]) => this.db.queryMany(sql, p).catch(() => []);
    const [photo, appointments, stats, cuenta, records, prescriptions, consents] = await Promise.all([
      this.db.queryOne(`SELECT data_url FROM patient_photos WHERE patient_id = $1`, [patientId]).catch(() => null),
      q(`SELECT a.id, to_char(a.date, 'YYYY-MM-DD') AS date, a.start_time, a.end_time, a.status, a.reason,
                a.cancelled_reason, a.created_by_type, d.first_name || ' ' || d.last_name AS doctor_name
         FROM appointments a
         JOIN organization_doctors od ON od.id = a.org_doctor_id
         JOIN doctors d ON d.id = od.doctor_id
         WHERE a.patient_id = $1 AND a.organization_id = $2
         ORDER BY a.date DESC, a.start_time DESC LIMIT 100`),
      this.db.queryOne(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'completed')::int AS atendidos,
                COUNT(*) FILTER (WHERE status = 'no_show')::int AS ausentes,
                COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelados,
                to_char(MIN(date) FILTER (WHERE status = 'completed'), 'YYYY-MM-DD') AS primera,
                to_char(MAX(date) FILTER (WHERE status = 'completed'), 'YYYY-MM-DD') AS ultima
         FROM appointments WHERE patient_id = $1 AND organization_id = $2`,
        [patientId, orgId],
      ).catch(() => null),
      this.db.queryOne(`SELECT email, created_at, last_login_at FROM patient_auth WHERE patient_id = $1`, [patientId]).catch(() => null),
      clinico ? q(`SELECT id, to_char(date, 'YYYY-MM-DD') AS date, record_type, chief_complaint, diagnosis, diagnosis_code,
                          allergies, current_medications, personal_history, family_history, habits, occupation, vital_signs,
                          doctor_full_name, present_illness, physical_exam, findings, treatment_plan, instructions, follow_up, systems_review,
                          version, deleted_at, annulled_reason
                   FROM medical_records WHERE patient_id = $1 AND organization_id = $2
                   ORDER BY date DESC, created_at DESC LIMIT 50`) : Promise.resolve([]),
      clinico ? q(`SELECT p.id, to_char(p.issued_at, 'YYYY-MM-DD') AS date, p.diagnosis, p.status, p.verification_code,
                          COALESCE(json_agg(json_build_object('name', i.medication_name, 'dosage', i.dosage, 'frequency', i.frequency)
                                   ORDER BY i.sort_order) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
                   FROM prescriptions p LEFT JOIN prescription_items i ON i.prescription_id = p.id
                   WHERE p.patient_id = $1 AND p.organization_id = $2
                   GROUP BY p.id ORDER BY p.issued_at DESC LIMIT 30`) : Promise.resolve([]),
      clinico ? q(`SELECT id, consent_type, accepted, to_char(accepted_at, 'YYYY-MM-DD') AS date, revoked_at
                   FROM informed_consents WHERE patient_id = $1 AND organization_id = $2 ORDER BY created_at DESC LIMIT 20`) : Promise.resolve([]),
    ]);
    const documents = clinico ? await q(`SELECT id, kind, title, description, to_char(COALESCE(study_date, created_at::date),'YYYY-MM-DD') AS date, mime_type, file_name,
                          size_bytes, (body_text IS NOT NULL) AS es_texto, shared_with_patient, created_at
                     FROM patient_documents WHERE patient_id = $1 AND organization_id = $2 AND deleted_at IS NULL
                     ORDER BY COALESCE(study_date, created_at::date) DESC, created_at DESC LIMIT 100`) : [];
    const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    const proximos = appointments.filter((a: any) => a.date >= hoy && !['cancelled', 'no_show', 'completed'].includes(a.status)).reverse();
    // Último dato clínico cargado (lo más reciente de la historia)
    const ultima = records.find((r: any) => !r.deleted_at) || null;
    return {
      patient: { ...patient, photo_url: photo?.data_url || null },
      stats: stats || {},
      proximos,
      appointments,
      cuenta: cuenta ? { email: cuenta.email, desde: cuenta.created_at, ultimoIngreso: cuenta.last_login_at } : null,
      clinico: clinico ? {
        ultimaConsulta: ultima,
        records,
        prescriptions,
        consents,
        documents,
      } : null,
    };
  }

  /** Resumen clínico del paciente: alergias, problemas activos, medicación y antecedentes (lo edita el médico) */
  async setResumenClinico(orgId: string, patientId: string, doctorId: string, b: any) {
    await this.findById(orgId, patientId);
    const arr = (x: any) => (Array.isArray(x) ? x : String(x ?? '').split(/[,;\n]/)).map((y: any) => String(y).trim()).filter(Boolean).slice(0, 50);
    const txt = (x: any) => (x == null ? null : String(x).trim().slice(0, 5000) || null);
    return this.db.queryOne(
      `UPDATE patients SET allergies = $3, chronic_conditions = $4, current_medications = $5,
              personal_history = $6, surgical_history = $7, family_history = $8, habits = $9, blood_type = COALESCE($10::blood_type, blood_type),
              clinical_summary_updated_at = now(), clinical_summary_updated_by = $11
        WHERE id = $1 AND organization_id = $2
        RETURNING allergies, chronic_conditions, current_medications, personal_history, surgical_history, family_history, habits, blood_type, clinical_summary_updated_at`,
      [patientId, orgId, arr(b.allergies), arr(b.chronicConditions), arr(b.currentMedications),
       txt(b.personalHistory), txt(b.surgicalHistory), txt(b.familyHistory), txt(b.habits), b.bloodType || null, doctorId],
    );
  }

  /** Foto del paciente como data URL (jpeg/png/webp, hasta ~400 KB) */
  async setPhoto(orgId: string, patientId: string, dataUrl: string, userId: string) {
    await this.findById(orgId, patientId);
    if (!dataUrl) {
      await this.db.query(`DELETE FROM patient_photos WHERE patient_id = $1`, [patientId]);
      return { photo_url: null };
    }
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw new BadRequestException('Formato de imagen inválido');
    if (dataUrl.length > 550_000) throw new BadRequestException('La imagen es muy grande');
    await this.db.query(
      `INSERT INTO patient_photos (patient_id, data_url, uploaded_by, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (patient_id) DO UPDATE SET data_url = EXCLUDED.data_url, uploaded_by = EXCLUDED.uploaded_by, updated_at = NOW()`,
      [patientId, dataUrl, userId],
    );
    return { photo_url: dataUrl };
  }
}
