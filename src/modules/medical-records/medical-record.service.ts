import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export interface CreateMedicalRecordDto {
  patientId: string;
  appointmentId?: string;
  recordType?: string;
  chiefComplaint: string;
  presentIllness?: string;
  personalHistory?: string;
  familyHistory?: string;
  currentMedications?: string;
  allergies?: string;
  habits?: string;
  systemsReview?: string;
  otherSymptoms?: string;
  vitalSigns?: {
    bloodPressure?: string;
    heartRate?: number;
    temperature?: number;
    respiratoryRate?: number;
    spO2?: number;
    weight?: number;
    height?: number;
    waistCircumference?: number;
    shoulderWidth?: number;
  };
  physicalExam?: string;
  findings?: string;
  diagnosis: string;
  diagnosisCode?: string;
  secondaryDiagnoses?: { diagnosis: string; code?: string }[];
  treatmentPlan?: string;
  instructions?: string;
  labOrders?: string[];
  imagingOrders?: string[];
  referrals?: string[];
  followUp?: string;
  prevention?: string;
  occupation?: string;
  privateNotes?: string;
}

@Injectable()
export class MedicalRecordService {
  private readonly logger = new Logger(MedicalRecordService.name);

  constructor(private db: DatabaseService) {}

  async findByPatient(orgId: string, patientId: string) {
    return this.db.queryMany(
      `SELECT mr.*, d.first_name || ' ' || d.last_name AS doctor_name
       FROM medical_records mr
       JOIN doctors d ON d.id = mr.doctor_id
       WHERE mr.patient_id = $1 AND mr.organization_id = $2
       ORDER BY mr.date DESC`,
      [patientId, orgId],
    );
  }

  async findById(orgId: string, id: string) {
    const record = await this.db.queryOne(
      `SELECT mr.*, d.first_name || ' ' || d.last_name AS doctor_name,
              p.first_name || ' ' || p.last_name AS patient_name
       FROM medical_records mr
       JOIN doctors d ON d.id = mr.doctor_id
       JOIN patients p ON p.id = mr.patient_id
       WHERE mr.id = $1 AND mr.organization_id = $2`,
      [id, orgId],
    );
    if (!record) throw new NotFoundException('Registro no encontrado');
    return record;
  }

  async create(orgId: string, doctorId: string, dto: CreateMedicalRecordDto) {
    const record = await this.db.queryOne(
      `INSERT INTO medical_records (
        patient_id, doctor_id, organization_id, appointment_id,
        record_type, chief_complaint, present_illness,
        personal_history, family_history, current_medications,
        allergies, habits, systems_review, other_symptoms,
        vital_signs, physical_exam, findings,
        diagnosis, diagnosis_code, secondary_diagnoses,
        treatment_plan, instructions, lab_orders, imaging_orders,
        referrals, follow_up, prevention, occupation, private_notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
      RETURNING *`,
      [
        dto.patientId, doctorId, orgId, dto.appointmentId,
        dto.recordType || 'consulta', dto.chiefComplaint, dto.presentIllness,
        dto.personalHistory, dto.familyHistory, dto.currentMedications,
        dto.allergies, dto.habits, dto.systemsReview, dto.otherSymptoms,
        JSON.stringify(dto.vitalSigns || {}), dto.physicalExam, dto.findings,
        dto.diagnosis, dto.diagnosisCode,
        JSON.stringify(dto.secondaryDiagnoses || []),
        dto.treatmentPlan, dto.instructions, dto.labOrders || [], dto.imagingOrders || [],
        dto.referrals || [], dto.followUp, dto.prevention, dto.occupation, dto.privateNotes,
      ],
    );

    if (dto.appointmentId) {
      await this.db.query(
        `UPDATE appointments SET status = 'completed' WHERE id = $1`,
        [dto.appointmentId],
      );
    }

    this.logger.log(`Medical record created for patient ${dto.patientId}`);
    return record;
  }

  async update(orgId: string, id: string, dto: Partial<CreateMedicalRecordDto>) {
    await this.findById(orgId, id);

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    const mapping: Record<string, string> = {
      recordType: 'record_type', chiefComplaint: 'chief_complaint',
      presentIllness: 'present_illness', personalHistory: 'personal_history',
      familyHistory: 'family_history', currentMedications: 'current_medications',
      allergies: 'allergies', habits: 'habits',
      systemsReview: 'systems_review', otherSymptoms: 'other_symptoms',
      physicalExam: 'physical_exam', findings: 'findings',
      diagnosis: 'diagnosis', diagnosisCode: 'diagnosis_code',
      treatmentPlan: 'treatment_plan', instructions: 'instructions',
      labOrders: 'lab_orders', imagingOrders: 'imaging_orders',
      referrals: 'referrals', followUp: 'follow_up',
      prevention: 'prevention', occupation: 'occupation',
      privateNotes: 'private_notes',
    };

    for (const [key, col] of Object.entries(mapping)) {
      if (dto[key] !== undefined) {
        fields.push(`${col} = $${idx}`);
        values.push(dto[key]);
        idx++;
      }
    }

    if (dto.vitalSigns !== undefined) {
      fields.push(`vital_signs = $${idx}`);
      values.push(JSON.stringify(dto.vitalSigns));
      idx++;
    }

    if (dto.secondaryDiagnoses !== undefined) {
      fields.push(`secondary_diagnoses = $${idx}`);
      values.push(JSON.stringify(dto.secondaryDiagnoses));
      idx++;
    }

    if (fields.length === 0) return this.findById(orgId, id);

    values.push(id, orgId);
    return this.db.queryOne(
      `UPDATE medical_records SET ${fields.join(', ')} WHERE id = $${idx} AND organization_id = $${idx + 1} RETURNING *`,
      values,
    );
  }
}
