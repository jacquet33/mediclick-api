import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export interface PrescriptionItemDto {
  medicationName: string;
  dosage: string;
  frequency: string;
  duration?: string;
  quantity?: number;
  instructions?: string;
}

export interface CreatePrescriptionDto {
  patientId: string;
  medicalRecordId?: string;
  diagnosis: string;
  diagnosisCode?: string;
  expiresInDays?: number;
  notes?: string;
  items: PrescriptionItemDto[];
}

@Injectable()
export class PrescriptionService {
  private readonly logger = new Logger(PrescriptionService.name);

  constructor(private db: DatabaseService) {}

  async findAll(orgId: string, doctorId: string, query?: { patientId?: string; status?: string; updatedSince?: string }) {
    let where = 'WHERE rx.organization_id = $1';
    const params: any[] = [orgId];
    let idx = 2;

    if (query?.patientId) {
      where += ` AND rx.patient_id = $${idx}`;
      params.push(query.patientId);
      idx++;
    }
    if (query?.status) {
      where += ` AND rx.status = $${idx}`;
      params.push(query.status);
      idx++;
    }
    if (query?.updatedSince) {
      where += ` AND rx.updated_at > $${idx}::timestamptz`;
      params.push(query.updatedSince);
      idx++;
    }

    return this.db.queryMany(
      `SELECT rx.*, p.first_name || ' ' || p.last_name AS patient_name,
              d.first_name || ' ' || d.last_name AS doctor_name
       FROM prescriptions rx
       JOIN patients p ON p.id = rx.patient_id
       JOIN doctors d ON d.id = rx.doctor_id
       ${where}
       ORDER BY rx.issued_at DESC`,
      params,
    );
  }

  async findById(orgId: string, id: string) {
    const rx = await this.db.queryOne(
      `SELECT rx.*, p.first_name || ' ' || p.last_name AS patient_name,
              p.dni AS patient_dni,
              d.first_name || ' ' || d.last_name AS doctor_name,
              d.medical_license AS doctor_license
       FROM prescriptions rx
       JOIN patients p ON p.id = rx.patient_id
       JOIN doctors d ON d.id = rx.doctor_id
       WHERE rx.id = $1 AND rx.organization_id = $2`,
      [id, orgId],
    );
    if (!rx) throw new NotFoundException('Receta no encontrada');

    const items = await this.db.queryMany(
      `SELECT * FROM prescription_items WHERE prescription_id = $1 ORDER BY sort_order`,
      [id],
    );

    return { ...rx, items };
  }

  async create(orgId: string, doctorId: string, dto: any) {
    return this.db.transaction(async (client) => {
      const patientId = dto.patientId || dto.patient_id;
      const diagnosis = dto.diagnosis;
      const diagnosisCode = dto.diagnosisCode || dto.diagnosis_code;
      const notes = dto.notes;
      const items = dto.items || [];

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + (dto.expiresInDays || dto.expires_in_days || 30));

      const rx = await client.query(
        `INSERT INTO prescriptions (
          doctor_id, patient_id, organization_id,
          diagnosis, diagnosis_code, expires_at, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING *`,
        [doctorId, patientId, orgId, diagnosis, diagnosisCode || null,
         expiresAt.toISOString(), notes || null],
      );

      const rxId = rx.rows[0].id;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await client.query(
          `INSERT INTO prescription_items (
            prescription_id, medication_name, dosage, frequency,
            duration, quantity, instructions, sort_order
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [rxId,
           item.medicationName || item.medication_name,
           item.dosage || null,
           item.frequency || null,
           item.duration || null,
           item.quantity || null,
           item.instructions || null, i],
        );
      }

      this.logger.log(`Prescription created: ${rxId} for patient ${patientId}`);
      return { ...rx.rows[0], items };
    });
  }

  async cancel(orgId: string, id: string) {
    await this.findById(orgId, id);
    return this.db.queryOne(
      `UPDATE prescriptions SET status = 'cancelled' WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [id, orgId],
    );
  }

  async verify(code: string) {
    const rx = await this.db.queryOne(
      `SELECT rx.*, p.first_name || ' ' || p.last_name AS patient_name,
              d.first_name || ' ' || d.last_name AS doctor_name,
              d.medical_license, o.name AS org_name
       FROM prescriptions rx
       JOIN patients p ON p.id = rx.patient_id
       JOIN doctors d ON d.id = rx.doctor_id
       JOIN organizations o ON o.id = rx.organization_id
       WHERE rx.verification_code = $1`,
      [code],
    );
    if (!rx) throw new NotFoundException('Código de verificación inválido');

    const items = await this.db.queryMany(
      `SELECT * FROM prescription_items WHERE prescription_id = $1 ORDER BY sort_order`,
      [rx.id],
    );

    return { ...rx, items };
  }
}
