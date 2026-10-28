import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';
import { FhirService } from './fhir.service';

/**
 * Envío de cada receta al repositorio central del Ministerio de Salud (Res. 2214/2025, art. 7 y Anexo IV):
 * fecha, profesional, CUIL del paciente, CUIR, id de transacción y la URL para ver la receta (Mi Argentina).
 * Se activa con MSAL_REPO_URL (+ MSAL_REPO_TOKEN) cuando el Ministerio entrega la conexión al aprobar la inscripción.
 * Mientras tanto las recetas quedan en cola ('pending') y se envían solas después.
 */
@Injectable()
export class CentralRepoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CentralRepoService.name);
  private timer: NodeJS.Timeout | null = null;
  constructor(private db: DatabaseService, private config: ConfigService, private fhir: FhirService) {}

  onModuleInit() {
    this.timer = setInterval(() => this.procesar().catch(() => undefined), 10 * 60_000);
    setTimeout(() => this.procesar().catch(() => undefined), 30_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async encolar(prescriptionId: string) {
    await this.db.query(
      `INSERT INTO central_repo_submissions (prescription_id) VALUES ($1) ON CONFLICT (prescription_id) DO NOTHING`,
      [prescriptionId],
    ).catch(() => undefined);
    this.procesar().catch(() => undefined);
  }

  async payload(prescriptionId: string) {
    const rx = await this.db.queryOne(
      `SELECT rx.id, rx.issued_at, rx.cuir, rx.verification_code, rx.patient_cuil,
              d.first_name, d.last_name, d.dni, d.refeps_code, d.medical_license, d.license_type, d.medical_license_province
       FROM prescriptions rx JOIN doctors d ON d.id = rx.doctor_id WHERE rx.id = $1`, [prescriptionId]);
    if (!rx) return null;
    const items = await this.db.queryMany(`SELECT cuir FROM prescription_items WHERE prescription_id = $1 ORDER BY sort_order, created_at`, [prescriptionId]);
    const base = this.config.get('BASE_URL') || 'https://tuconsultorio.rispy.io';
    return {
      fechaPrescripcion: new Date(rx.issued_at).toISOString(),
      profesional: {
        nombre: rx.first_name, apellido: rx.last_name, dni: rx.dni, refeps: rx.refeps_code,
        matricula: rx.medical_license, tipoMatricula: rx.license_type, jurisdiccion: rx.medical_license_province,
      },
      pacienteCuil: rx.patient_cuil,
      cuir: items.map((i) => i.cuir).filter(Boolean),
      cuirGrupo: rx.cuir,
      idTransaccion: rx.id,
      endpoint: `${base}/api/v1/prescriptions/verify/${rx.verification_code}/pdf`,
      fhir: await this.fhir.bundle(prescriptionId).catch(() => undefined),
    };
  }

  private corriendo = false;
  async procesar() {
    const url = this.config.get<string>('MSAL_REPO_URL');
    if (!url || this.corriendo) return;
    this.corriendo = true;
    try {
      const pend = await this.db.queryMany(
        `SELECT prescription_id FROM central_repo_submissions WHERE status IN ('pending','error') AND attempts < 20 ORDER BY created_at LIMIT 50`);
      for (const p of pend) {
        const body = await this.payload(p.prescription_id);
        try {
          const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(this.config.get('MSAL_REPO_TOKEN') ? { Authorization: `Bearer ${this.config.get('MSAL_REPO_TOKEN')}` } : {}) },
            body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
          });
          if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
          await this.db.query(`UPDATE central_repo_submissions SET status = 'sent', sent_at = NOW(), attempts = attempts + 1, payload = $2, last_error = NULL WHERE prescription_id = $1`, [p.prescription_id, body]);
        } catch (e) {
          await this.db.query(`UPDATE central_repo_submissions SET status = 'error', attempts = attempts + 1, last_error = $2 WHERE prescription_id = $1`, [p.prescription_id, e.message]);
        }
      }
    } finally { this.corriendo = false; }
  }
}
