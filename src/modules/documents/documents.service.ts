import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

const TIPOS = ['estudio', 'informe', 'indicaciones', 'imagen', 'certificado', 'otro'];
const MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'text/plain'];
const MAX_BYTES = 7 * 1024 * 1024;

/** Estudios, informes, imágenes e indicaciones del paciente. Se pueden compartir con el paciente. */
@Injectable()
export class DocumentsService {
  constructor(private db: DatabaseService) {}

  private async paciente(orgId: string, patientId: string) {
    const p = await this.db.queryOne(`SELECT id FROM patients WHERE id = $1 AND organization_id = $2`, [patientId, orgId]);
    if (!p) throw new NotFoundException('Paciente no encontrado');
  }

  private readonly columnas = `d.id, d.patient_id, d.medical_record_id, d.kind, d.title, d.description, to_char(d.study_date,'YYYY-MM-DD') AS study_date,
    d.mime_type, d.file_name, d.size_bytes, (d.body_text IS NOT NULL) AS es_texto, d.body_text, d.shared_with_patient, d.shared_at, d.created_at,
    d.uploaded_by_type, COALESCE(doc.first_name || ' ' || doc.last_name, '') AS autor`;

  async listar(orgId: string, patientId: string) {
    await this.paciente(orgId, patientId);
    return this.db.queryMany(
      `SELECT ${this.columnas} FROM patient_documents d LEFT JOIN doctors doc ON doc.id = d.uploaded_by
        WHERE d.patient_id = $1 AND d.organization_id = $2 AND d.deleted_at IS NULL
        ORDER BY COALESCE(d.study_date, d.created_at::date) DESC, d.created_at DESC`,
      [patientId, orgId],
    );
  }

  async crear(orgId: string, patientId: string, doctorId: string, b: any) {
    await this.paciente(orgId, patientId);
    const kind = TIPOS.includes(b?.kind) ? b.kind : 'otro';
    const title = String(b?.title || '').trim().slice(0, 200);
    if (!title) throw new BadRequestException('Poné un título (ej: "Hemograma", "Rx de tórax")');
    let content: Buffer | null = null, mime: string | null = null;
    if (b?.dataUrl) {
      const m = String(b.dataUrl).match(/^data:([\w/+.-]+);base64,(.+)$/s);
      if (!m) throw new BadRequestException('Archivo inválido');
      mime = m[1].toLowerCase();
      if (!MIMES.includes(mime)) throw new BadRequestException('Formatos admitidos: PDF, JPG, PNG, WEBP o HEIC');
      content = Buffer.from(m[2], 'base64');
      if (content.length > MAX_BYTES) throw new BadRequestException('El archivo supera 7 MB');
    }
    const body = b?.bodyText ? String(b.bodyText).slice(0, 20000) : null;
    if (!content && !body) throw new BadRequestException('Adjuntá un archivo o escribí el contenido');
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(b?.studyDate || '')) ? b.studyDate : null;
    const share = b?.shared === true;
    return this.db.queryOne(
      `INSERT INTO patient_documents (organization_id, patient_id, medical_record_id, uploaded_by_type, uploaded_by, kind, title, description,
                                      study_date, mime_type, file_name, size_bytes, content, body_text, shared_with_patient, shared_at)
       VALUES ($1,$2,$3,'doctor',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, CASE WHEN $14 THEN now() END)
       RETURNING id, kind, title, shared_with_patient, created_at`,
      [orgId, patientId, b?.medicalRecordId || null, doctorId, kind, title, b?.description ? String(b.description).slice(0, 2000) : null,
       fecha, mime, b?.fileName ? String(b.fileName).slice(0, 200) : null, content ? content.length : null, content, body, share],
    );
  }

  async compartir(orgId: string, patientId: string, id: string, shared: boolean) {
    const r = await this.db.queryOne(
      `UPDATE patient_documents SET shared_with_patient = $4, shared_at = CASE WHEN $4 THEN now() ELSE NULL END
        WHERE id = $1 AND patient_id = $2 AND organization_id = $3 AND deleted_at IS NULL RETURNING id, shared_with_patient`,
      [id, patientId, orgId, !!shared],
    );
    if (!r) throw new NotFoundException('Documento no encontrado');
    return r;
  }

  /** No se borra: queda anulado con el motivo (forma parte de la historia clínica) */
  async anular(orgId: string, patientId: string, id: string, reason: string) {
    if (!String(reason || '').trim()) throw new BadRequestException('Indicá el motivo');
    const r = await this.db.queryOne(
      `UPDATE patient_documents SET deleted_at = now(), deleted_reason = $4, shared_with_patient = false
        WHERE id = $1 AND patient_id = $2 AND organization_id = $3 AND deleted_at IS NULL RETURNING id`,
      [id, patientId, orgId, String(reason).slice(0, 500)],
    );
    if (!r) throw new NotFoundException('Documento no encontrado');
    return { ok: true };
  }

  async archivo(orgId: string, patientId: string, id: string) {
    const r = await this.db.queryOne(
      `SELECT title, file_name, mime_type, content, body_text FROM patient_documents
        WHERE id = $1 AND patient_id = $2 AND organization_id = $3 AND deleted_at IS NULL`,
      [id, patientId, orgId],
    );
    if (!r) throw new NotFoundException('Documento no encontrado');
    return r;
  }

  // ─── Paciente logueado: solo lo que el consultorio compartió ───
  private async pacienteDe(authId: string) {
    const a = await this.db.queryOne(`SELECT patient_id FROM patient_auth WHERE id = $1`, [authId]);
    if (!a?.patient_id) throw new ForbiddenException('Cuenta sin paciente asociado');
    return a.patient_id;
  }

  async misDocumentos(authId: string) {
    const pid = await this.pacienteDe(authId);
    return this.db.queryMany(
      `SELECT d.id, d.kind, d.title, d.description, to_char(d.study_date,'YYYY-MM-DD') AS study_date, d.mime_type, d.file_name, d.size_bytes,
              d.body_text, d.shared_at, d.created_at, o.name AS consultorio, COALESCE(doc.first_name || ' ' || doc.last_name, '') AS autor
         FROM patient_documents d JOIN organizations o ON o.id = d.organization_id LEFT JOIN doctors doc ON doc.id = d.uploaded_by
        WHERE d.patient_id = $1 AND d.shared_with_patient AND d.deleted_at IS NULL
        ORDER BY d.shared_at DESC NULLS LAST, d.created_at DESC`,
      [pid],
    );
  }

  async miArchivo(authId: string, id: string) {
    const pid = await this.pacienteDe(authId);
    const r = await this.db.queryOne(
      `SELECT title, file_name, mime_type, content, body_text FROM patient_documents
        WHERE id = $1 AND patient_id = $2 AND shared_with_patient AND deleted_at IS NULL`,
      [id, pid],
    );
    if (!r) throw new NotFoundException('Documento no encontrado');
    return r;
  }
}
