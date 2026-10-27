import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { DatabaseService } from '../../database/database.service';

/**
 * Firma electrónica de recetas (Ley 27.553 / Ley 25.506):
 * - se arma un contenido canónico con médico (matrícula), paciente (DNI, cobertura), diagnóstico e ítems
 * - SHA-256 del contenido + firma Ed25519 con la clave de la plataforma
 * - el código QR lleva a /verificar-receta, que recalcula el hash y valida la firma
 * La clave privada viene de PRESCRIPTION_SIGNING_KEY (PEM) o se genera una vez y se guarda en platform_keys.
 */
@Injectable()
export class PrescriptionSigningService {
  private readonly logger = new Logger(PrescriptionSigningService.name);
  private keyCache: { id: string; priv: crypto.KeyObject; pub: crypto.KeyObject } | null = null;

  constructor(private db: DatabaseService, private config: ConfigService) {}

  private async clave() {
    if (this.keyCache) return this.keyCache;
    const pem = this.config.get<string>('PRESCRIPTION_SIGNING_KEY');
    let priv: crypto.KeyObject;
    if (pem) {
      priv = crypto.createPrivateKey(pem.replace(/\\n/g, '\n'));
    } else {
      const row = await this.db.queryOne(
        `SELECT private_key_pem FROM platform_keys WHERE purpose = 'prescription' AND private_key_pem IS NOT NULL ORDER BY created_at LIMIT 1`,
      );
      if (row) priv = crypto.createPrivateKey(row.private_key_pem);
      else {
        const { privateKey } = crypto.generateKeyPairSync('ed25519');
        priv = privateKey;
      }
    }
    const pub = crypto.createPublicKey(priv);
    const pubPem = pub.export({ type: 'spki', format: 'pem' }).toString();
    const id = crypto.createHash('sha256').update(pubPem).digest('hex').slice(0, 16);
    await this.db.query(
      `INSERT INTO platform_keys (id, purpose, public_key_pem, private_key_pem) VALUES ($1, 'prescription', $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [id, pubPem, pem ? null : priv.export({ type: 'pkcs8', format: 'pem' }).toString()],
    );
    this.keyCache = { id, priv, pub };
    return this.keyCache;
  }

  /** Contenido que se firma: cualquier cambio en estos datos invalida la firma */
  async contenido(prescriptionId: string) {
    const rx = await this.db.queryOne(
      `SELECT rx.id, rx.cuir, rx.verification_code, rx.issued_at, rx.expires_at, rx.diagnosis, rx.diagnosis_code,
              d.first_name AS d_fn, d.last_name AS d_ln, d.medical_license, d.license_type, d.medical_license_province, d.dni AS d_dni, d.specialty,
              p.first_name AS p_fn, p.last_name AS p_ln, p.dni AS p_dni, p.date_of_birth, p.insurance_provider, p.insurance_number, p.insurance_plan,
              o.name AS org_name
       FROM prescriptions rx
       JOIN doctors d ON d.id = rx.doctor_id
       JOIN patients p ON p.id = rx.patient_id
       JOIN organizations o ON o.id = rx.organization_id
       WHERE rx.id = $1`,
      [prescriptionId],
    );
    if (!rx) return null;
    const items = await this.db.queryMany(
      `SELECT generic_name, medication_name, presentation, pharmaceutical_form, dosage, frequency, duration, quantity
       FROM prescription_items WHERE prescription_id = $1 ORDER BY sort_order, created_at`,
      [prescriptionId],
    );
    const t = (x: any) => (x == null ? '' : String(x).trim());
    return {
      v: 1,
      cuir: t(rx.cuir),
      codigo: t(rx.verification_code),
      emitida: new Date(rx.issued_at).toISOString(),
      vence: rx.expires_at ? new Date(rx.expires_at).toISOString() : '',
      prescriptor: {
        nombre: `${t(rx.d_fn)} ${t(rx.d_ln)}`.trim(), dni: t(rx.d_dni), matricula: t(rx.medical_license),
        tipo: t(rx.license_type), provincia: t(rx.medical_license_province), especialidad: t(rx.specialty),
      },
      paciente: {
        nombre: `${t(rx.p_fn)} ${t(rx.p_ln)}`.trim(), dni: t(rx.p_dni),
        nacimiento: rx.date_of_birth ? new Date(rx.date_of_birth).toISOString().slice(0, 10) : '',
        cobertura: t(rx.insurance_provider), plan: t(rx.insurance_plan), afiliado: t(rx.insurance_number),
      },
      establecimiento: t(rx.org_name),
      diagnostico: t(rx.diagnosis), cie10: t(rx.diagnosis_code),
      items: items.map((i) => ({
        generico: t(i.generic_name), comercial: t(i.medication_name), presentacion: t(i.presentation),
        forma: t(i.pharmaceutical_form), dosis: t(i.dosage), frecuencia: t(i.frequency), duracion: t(i.duration), cantidad: t(i.quantity),
      })),
    };
  }

  private hash(c: any) {
    return crypto.createHash('sha256').update(JSON.stringify(c)).digest('hex');
  }

  /** Asigna CUIR (si falta), calcula hash y firma */
  async firmar(prescriptionId: string) {
    const k = await this.clave();
    const plataforma = (this.config.get<string>('RENAPDIS_PLATFORM_ID') || 'TCO').replace(/[^A-Za-z0-9]/g, '').slice(0, 20) || 'TCO';
    await this.db.query(
      `UPDATE prescriptions SET cuir = COALESCE(cuir, $2 || '-' || to_char(issued_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYYMMDD') || '-' || verification_code)
       WHERE id = $1`,
      [prescriptionId, plataforma],
    );
    const c = await this.contenido(prescriptionId);
    if (!c) return null;
    const h = this.hash(c);
    const firma = crypto.sign(null, Buffer.from(h, 'hex'), k.priv).toString('base64');
    await this.db.query(
      `UPDATE prescriptions SET content_hash = $2, digital_signature = $3, signature_key_id = $4, signed_at = NOW() WHERE id = $1`,
      [prescriptionId, h, firma, k.id],
    );
    return { cuir: c.cuir, hash: h, firma, keyId: k.id };
  }

  /** Revisa que la receta no se haya modificado y que la firma sea de la plataforma */
  async verificar(prescriptionId: string) {
    const rx = await this.db.queryOne(
      `SELECT content_hash, digital_signature, signature_key_id, signed_at FROM prescriptions WHERE id = $1`,
      [prescriptionId],
    );
    if (!rx?.digital_signature || !rx.content_hash) return { firmada: false, valida: false, motivo: 'Receta emitida antes de la firma electrónica' };
    const c = await this.contenido(prescriptionId);
    const h = this.hash(c);
    if (h !== rx.content_hash) return { firmada: true, valida: false, motivo: 'El contenido fue modificado después de firmarse' };
    const key = await this.db.queryOne(`SELECT public_key_pem FROM platform_keys WHERE id = $1`, [rx.signature_key_id]);
    if (!key) return { firmada: true, valida: false, motivo: 'Clave de firma desconocida' };
    let ok = false;
    try {
      ok = crypto.verify(null, Buffer.from(h, 'hex'), crypto.createPublicKey(key.public_key_pem), Buffer.from(rx.digital_signature, 'base64'));
    } catch { ok = false; }
    return { firmada: true, valida: ok, motivo: ok ? 'Firma electrónica válida' : 'Firma inválida', hash: h, firmadaEl: rx.signed_at, clave: rx.signature_key_id };
  }
}
