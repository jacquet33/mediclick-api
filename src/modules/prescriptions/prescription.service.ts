import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { VerificationService } from '../verification/verification.service';
import { PrescriptionSigningService } from './prescription-signing.service';
import { DigitalSignatureService } from './digital-signature.service';
import { cuilDesdeDni, cuilValido } from '../../common/utils/argentina';
import { CentralRepoService } from './central-repo.service';

export interface PrescriptionItemDto {
  medicationName: string;
  genericName?: string;
  dosage: string;
  frequency: string;
  duration?: string;
  quantity?: number;
  instructions?: string;
  pharmaceuticalForm?: string;
  presentation?: string;
  // snake_case aliases from iOS
  medication_name?: string;
  generic_name?: string;
  pharmaceutical_form?: string;
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

  constructor(
    private db: DatabaseService,
    private verification: VerificationService,
    private signing: PrescriptionSigningService,
    private digital: DigitalSignatureService,
    private centralRepo: CentralRepoService,
  ) {}

  /** PDF firmado digitalmente (si existe) */
  async signedPdf(id: string): Promise<Buffer | null> {
    const r = await this.db.queryOne(`SELECT signed_pdf FROM prescriptions WHERE id = $1`, [id]);
    return r?.signed_pdf || null;
  }

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
      `SELECT rx.id, rx.patient_id, rx.doctor_id, rx.organization_id, rx.medical_record_id, rx.status, rx.diagnosis, rx.diagnosis_code,
              rx.issued_at, rx.expires_at, rx.verification_code, rx.notes, rx.cuir, rx.content_hash, rx.signed_at, rx.created_at, rx.updated_at,
              rx.digital_signed_at,
              p.first_name || ' ' || p.last_name AS patient_name, p.phone AS patient_phone, p.email AS patient_email,
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
              p.dni AS patient_dni, p.email AS patient_email, p.phone AS patient_phone,
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
    // Solo médicos con matrícula verificada (REFEPS o revisión manual)
    await this.verification.exigirVerificado(doctorId);

    const patientId = dto.patientId || dto.patient_id;
    const items = (dto.items || []).filter((i: any) => (i.medicationName || i.medication_name || i.genericName || i.generic_name || '').trim());
    if (!items.length) throw new BadRequestException('Agregá al menos un medicamento');
    const incompleto = items.findIndex((i: any) => !String(i.dosage || '').trim() || !String(i.frequency || '').trim());
    if (incompleto >= 0) throw new BadRequestException(`Completá la dosis y la frecuencia del medicamento ${incompleto + 1}`);
    if (!dto.diagnosis?.trim()) throw new BadRequestException('Indicá el diagnóstico');
    const paciente = await this.db.queryOne(`SELECT dni, cuil, gender FROM patients WHERE id = $1 AND organization_id = $2`, [patientId, orgId]);
    if (!paciente) throw new NotFoundException('Paciente no encontrado');
    if (!String(paciente.dni || '').replace(/\D/g, '')) {
      throw new BadRequestException('Para la receta electrónica el paciente tiene que tener DNI cargado');
    }
    // CUIL del paciente (Res. 2214/2025): el indicado, el cargado o calculado con DNI + sexo
    const cuil = String(dto.patientCuil || dto.patient_cuil || paciente.cuil || cuilDesdeDni(paciente.dni, paciente.gender) || '').replace(/\D/g, '');
    if (!cuilValido(cuil)) {
      throw new BadRequestException('Indicá el CUIL del paciente (o cargá su sexo para calcularlo desde el DNI)');
    }
    if (!cuil.includes(String(paciente.dni).replace(/\D/g, '').padStart(8, '0'))) {
      throw new BadRequestException('El CUIL no corresponde al DNI del paciente');
    }

    const creada = await this.db.transaction(async (client) => {
      const diagnosis = dto.diagnosis;
      const diagnosisCode = dto.diagnosisCode || dto.diagnosis_code;
      const notes = dto.notes;

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
            prescription_id, medication_name, generic_name, dosage, frequency,
            duration, quantity, instructions, pharmaceutical_form, presentation, sort_order
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [rxId,
           item.medicationName || item.medication_name || item.genericName || item.generic_name,
           // Nombre genérico obligatorio (Ley 25.649): si no viene, se usa el indicado
           item.genericName || item.generic_name || item.medicationName || item.medication_name,
           item.dosage || null,
           item.frequency || null,
           item.duration || null,
           item.quantity || null,
           item.instructions || null,
           item.pharmaceuticalForm || item.pharmaceutical_form || null,
           item.presentation || null,
           i],
        );
      }

      this.logger.log(`Prescription created: ${rxId} for patient ${patientId}`);
      return { ...rx.rows[0], items };
    });

    const segs = Number(dto.composeSeconds);
    const alertas = Array.isArray(dto.alertsAcknowledged) ? dto.alertsAcknowledged.slice(0, 30).map((a: any) => ({ nivel: String(a?.nivel || '').slice(0, 20), tipo: String(a?.tipo || '').slice(0, 20), texto: String(a?.texto || '').slice(0, 400) })) : null;
    await this.db.query(
      `UPDATE prescriptions SET patient_cuil = $2, compose_seconds = $3, alerts_acknowledged = $4 WHERE id = $1`,
      [creada.id, cuil, Number.isFinite(segs) && segs > 0 && segs < 6 * 3600 ? Math.round(segs) : null, alertas && alertas.length ? JSON.stringify(alertas) : null],
    );
    await this.db.query(`UPDATE patients SET cuil = $2 WHERE id = $1 AND COALESCE(cuil, '') = ''`, [patientId, cuil]).catch(() => undefined);

    // Firma electrónica y CUIR (después de confirmar la receta)
    const firma = await this.signing.firmar(creada.id).catch((e) => {
      this.logger.error(`No se pudo firmar la receta ${creada.id}: ${e.message}`);
      return null;
    });
    if (firma) await this.centralRepo.encolar(creada.id);
    return { ...creada, cuir: firma?.cuir, content_hash: firma?.hash, firmada: !!firma };
  }

  /** Medicamentos que más receta el médico (con la dosis, frecuencia y duración que más usa) */
  async frecuentes(doctorId: string, limite = 12) {
    return this.db.queryMany(
      `WITH it AS (
         SELECT COALESCE(NULLIF(i.generic_name,''), i.medication_name) AS generico, i.medication_name, i.pharmaceutical_form,
                i.presentation, i.dosage, i.frequency, i.duration, i.quantity, i.instructions, rx.issued_at
           FROM prescription_items i JOIN prescriptions rx ON rx.id = i.prescription_id
          WHERE rx.doctor_id = $1 AND rx.issued_at > now() - interval '18 months'
       ), top AS (
         SELECT lower(generico) AS k, count(*) AS usos, max(issued_at) AS ultima FROM it GROUP BY 1 ORDER BY usos DESC, ultima DESC LIMIT $2
       )
       SELECT t.usos, x.* FROM top t
       JOIN LATERAL (
         SELECT generico, medication_name, pharmaceutical_form, presentation, dosage, frequency, duration, quantity, instructions,
                count(*) OVER (PARTITION BY dosage, frequency, duration) AS n
           FROM it WHERE lower(it.generico) = t.k ORDER BY n DESC, issued_at DESC LIMIT 1
       ) x ON true
       ORDER BY t.usos DESC, t.ultima DESC`,
      [doctorId, limite],
    );
  }

  /** Últimas recetas del paciente con sus medicamentos (para repetirlas) */
  async ultimasDelPaciente(orgId: string, patientId: string, limite = 6) {
    const rxs = await this.db.queryMany(
      `SELECT rx.id, rx.diagnosis, rx.diagnosis_code, rx.issued_at, rx.status, rx.expires_at,
              d.first_name || ' ' || d.last_name AS doctor_name
         FROM prescriptions rx JOIN doctors d ON d.id = rx.doctor_id
        WHERE rx.organization_id = $1 AND rx.patient_id = $2
        ORDER BY rx.issued_at DESC LIMIT $3`,
      [orgId, patientId, limite],
    );
    if (!rxs.length) return [];
    const items = await this.db.queryMany(
      `SELECT prescription_id, medication_name, generic_name, pharmaceutical_form, presentation, dosage, frequency, duration, quantity, instructions
         FROM prescription_items WHERE prescription_id = ANY($1::uuid[]) ORDER BY sort_order`,
      [rxs.map((r: any) => r.id)],
    );
    return rxs.map((r: any) => ({ ...r, items: items.filter((i: any) => i.prescription_id === r.id) }));
  }

  /** Tiempo promedio que le lleva al médico emitir una receta (últimos 90 días) */
  async metricas(doctorId: string) {
    return this.db.queryOne(
      `SELECT count(*)::int AS recetas,
              count(compose_seconds)::int AS medidas,
              round(avg(compose_seconds))::int AS segundos_promedio,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY compose_seconds)::int AS segundos_mediana
         FROM prescriptions WHERE doctor_id = $1 AND issued_at > now() - interval '90 days'`,
      [doctorId],
    );
  }

  async cancel(orgId: string, id: string) {
    await this.findById(orgId, id);
    return this.db.queryOne(
      `UPDATE prescriptions SET status = 'cancelled' WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [id, orgId],
    );
  }

  async verify(code: string, interno = false) {
    const rx = await this.db.queryOne(
      `SELECT rx.id, rx.organization_id, rx.cuir, rx.verification_code, rx.diagnosis, rx.diagnosis_code,
              d.license_type, d.medical_license_province, COALESCE(d.license_status, 'unverified') AS doctor_license_status,
              rx.issued_at, rx.expires_at, rx.status, rx.notes,
              p.first_name || ' ' || p.last_name AS patient_name,
              d.first_name || ' ' || d.last_name AS doctor_name,
              d.medical_license, d.specialty,
              o.name AS org_name
       FROM prescriptions rx
       JOIN patients p ON p.id = rx.patient_id
       JOIN doctors d ON d.id = rx.doctor_id
       JOIN organizations o ON o.id = rx.organization_id
       WHERE rx.verification_code = $1`,
      [code],
    );
    if (!rx) throw new NotFoundException('Código de verificación inválido');

    const items = await this.db.queryMany(
      `SELECT medication_name, generic_name, dosage, frequency, duration, quantity,
              pharmaceutical_form, presentation
       FROM prescription_items WHERE prescription_id = (
         SELECT id FROM prescriptions WHERE verification_code = $1
       ) ORDER BY sort_order`,
      [code],
    );

    const firma = await this.signing.verificar(rx.id).catch(() => ({ firmada: false, valida: false, motivo: 'No se pudo verificar' }));
    const vencida = rx.expires_at && new Date(rx.expires_at) < new Date();
    const firmaDigital = await this.digital.verificarReceta(rx.id).catch(() => ({ firmada: false }));
    const dispensas = await this.db.queryMany(
      `SELECT d.created_at, ph.name AS farmacia, d.items FROM prescription_dispensations d JOIN pharmacies ph ON ph.id = d.pharmacy_id
       WHERE d.prescription_id = $1 ORDER BY d.created_at`, [rx.id]).catch(() => []);
    const out: any = { ...rx, items, firma, firmaDigital, dispensas, vigente: ['active', 'partially_dispensed'].includes(rx.status) && !vencida };
    if (!interno) { delete out.id; delete out.organization_id; }
    return out;
  }
}
