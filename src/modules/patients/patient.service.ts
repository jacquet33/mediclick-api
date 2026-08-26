import { Injectable, NotFoundException, Logger } from '@nestjs/common';
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

  async create(orgId: string, dto: CreatePatientDto) {
    const patient = await this.db.queryOne(
      `INSERT INTO patients (
        organization_id, first_name, last_name, dni, email, phone,
        date_of_birth, gender, blood_type, address, city, province,
        emergency_contact_name, emergency_contact_phone,
        insurance_provider, insurance_number, insurance_plan,
        primary_doctor_id, allergies, chronic_conditions, current_medications, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      RETURNING *`,
      [
        orgId, dto.firstName, dto.lastName, dto.dni, dto.email, dto.phone,
        dto.dateOfBirth, dto.gender || 'not_specified', dto.bloodType || 'unknown',
        dto.address, dto.city, dto.province,
        dto.emergencyContactName, dto.emergencyContactPhone,
        dto.insuranceProvider, dto.insuranceNumber, dto.insurancePlan,
        dto.primaryDoctorId, dto.allergies || [], dto.chronicConditions || [],
        dto.currentMedications || [], dto.notes,
      ],
    );
    this.logger.log(`Patient created: ${dto.firstName} ${dto.lastName} in org ${orgId}`);
    return patient;
  }

  async update(orgId: string, id: string, dto: Partial<CreatePatientDto>) {
    await this.findById(orgId, id);

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    const mapping: Record<string, string> = {
      firstName: 'first_name', lastName: 'last_name', dni: 'dni',
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
}
