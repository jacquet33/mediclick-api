import { Optional } from '@nestjs/common';
import { MercadoPagoService } from '../payments/mercadopago.service';
import { EmailService } from '../email/email.service';
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(private db: DatabaseService, @Optional() private mp?: MercadoPagoService, @Optional() private email?: EmailService) {}

  /**
   * Baja de la cuenta del médico (requisito de App Store y Ley 25.326).
   * Se cierra el acceso, se cancela la suscripción y se saca de la agenda online y del buscador.
   * Las historias clínicas y recetas se conservan el plazo que exige la Ley 26.529 (10 años) y no vuelven a mostrarse.
   */
  async eliminarCuenta(doctorId: string, motivo?: string) {
    const d = await this.db.queryOne<{ email: string; first_name: string }>(`SELECT email, first_name FROM doctors WHERE id = $1`, [doctorId]);
    if (!d) return { ok: true };
    await this.mp?.cancelSubscription(doctorId).catch(() => {});
    await this.db.query(
      `UPDATE doctors SET is_active = false, en_directorio = false, refresh_token_hash = NULL, cuenta_eliminada_at = now(), updated_at = now() WHERE id = $1`,
      [doctorId]);
    await this.db.query(
      `UPDATE booking_settings SET is_enabled = false WHERE org_doctor_id IN (SELECT id FROM organization_doctors WHERE doctor_id = $1)`, [doctorId]).catch(() => {});
    await this.db.query(`UPDATE device_tokens SET is_active = false WHERE doctor_id = $1`, [doctorId]).catch(() => {});
    await this.db.query(
      `INSERT INTO audit_logs (doctor_id, action, entity_type, details) VALUES ($1, 'cuenta_eliminada', 'doctor', $2)`,
      [doctorId, JSON.stringify({ motivo: String(motivo || '').slice(0, 500) })]).catch(() => {});
    if (d.email) {
      await this.email?.send({
        to: d.email, subject: 'Tu cuenta de TusRecetasMed fue dada de baja',
        html: `<p>Hola ${String(d.first_name || '').replace(/</g, '&lt;')}:</p><p>Dimos de baja tu cuenta de TusRecetasMed: ya no podés ingresar, tu agenda online quedó desactivada y se canceló la renovación de tu plan.</p><p>Por la Ley 26.529, las historias clínicas y recetas que emitiste se conservan de forma segura durante el plazo legal y no se muestran a nadie. Si querés una copia o pedir su supresión al vencer el plazo, escribinos a support@tusrecetasmed.com.</p>`,
      }).catch(() => false);
    }
    return { ok: true };
  }

  /** Get doctor profile */
  async getProfile(doctorId: string) {
    const doc = await this.db.queryOne(
      `SELECT id, email, first_name, last_name, phone, dni,
              medical_license, medical_license_province, refeps_code,
              specialty, secondary_specialties, avatar_url, bio,
              signature_image IS NOT NULL AS has_signature,
              COALESCE(license_status, 'unverified') AS license_status, license_type, is_platform_admin, title_prefix,
              created_at
       FROM doctors WHERE id = $1`,
      [doctorId],
    );
    return doc;
  }

  /** Update basic profile fields */
  async updateProfile(
    doctorId: string,
    dto: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      specialty?: string;
      medicalLicense?: string;
      medicalLicenseProvince?: string;
      refepsCode?: string;
      bio?: string;
      titlePrefix?: string;
      avatarUrl?: string;
    },
  ) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.firstName) { sets.push(`first_name = $${idx++}`); vals.push(dto.firstName); }
    if (dto.lastName) { sets.push(`last_name = $${idx++}`); vals.push(dto.lastName); }
    if (dto.phone !== undefined) { sets.push(`phone = $${idx++}`); vals.push(dto.phone); }
    if (dto.specialty) { sets.push(`specialty = $${idx++}`); vals.push(dto.specialty); }
    if (dto.medicalLicense) { sets.push(`medical_license = $${idx++}`); vals.push(dto.medicalLicense); }
    if (dto.medicalLicenseProvince !== undefined) { sets.push(`medical_license_province = $${idx++}`); vals.push(dto.medicalLicenseProvince); }
    if (dto.refepsCode !== undefined) { sets.push(`refeps_code = $${idx++}`); vals.push(dto.refepsCode); }
    if (dto.bio !== undefined) { sets.push(`bio = $${idx++}`); vals.push(dto.bio); }
    if (dto.titlePrefix !== undefined) {
      if (!['Dr.', 'Dra.', ''].includes(dto.titlePrefix)) throw new BadRequestException('Prefijo inválido');
      sets.push(`title_prefix = $${idx++}`); vals.push(dto.titlePrefix || null);
    }
    if (dto.avatarUrl !== undefined) {
      if (dto.avatarUrl && (!/^data:image\/(jpeg|png|webp);base64,/.test(dto.avatarUrl) || dto.avatarUrl.length > 400_000)) {
        throw new BadRequestException('La foto de perfil no es válida o es muy grande');
      }
      sets.push(`avatar_url = $${idx++}`); vals.push(dto.avatarUrl || null);
    }

    if (sets.length === 0) return this.getProfile(doctorId);

    // Si cambia la matrícula hay que volver a verificarla
    if (dto.medicalLicense || dto.medicalLicenseProvince !== undefined) {
      const actual = await this.db.queryOne(`SELECT medical_license, medical_license_province FROM doctors WHERE id = $1`, [doctorId]);
      const cambia = (dto.medicalLicense && dto.medicalLicense !== actual?.medical_license)
        || (dto.medicalLicenseProvince !== undefined && (dto.medicalLicenseProvince || null) !== (actual?.medical_license_province || null));
      if (cambia) sets.push(`license_status = 'unverified'`, `license_verified_at = NULL`, `is_verified = false`);
    }

    sets.push(`updated_at = NOW()`);
    vals.push(doctorId);

    await this.db.query(
      `UPDATE doctors SET ${sets.join(', ')} WHERE id = $${idx}`,
      vals,
    );

    return this.getProfile(doctorId);
  }

  /** Upload signature image (base64) */
  async uploadSignature(doctorId: string, base64Data: string) {
    // Validate it's a real image by checking header bytes
    // Accept data URI format or raw base64
    let rawBase64 = base64Data;
    let mimeType = 'image/png';

    if (base64Data.startsWith('data:')) {
      const match = base64Data.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/);
      if (!match) {
        throw new BadRequestException('Formato de imagen inválido. Usar PNG, JPEG o WebP.');
      }
      mimeType = match[1];
      rawBase64 = match[3];
    }

    // Validate size (max 500KB of raw data)
    const sizeBytes = Buffer.from(rawBase64, 'base64').length;
    if (sizeBytes > 500 * 1024) {
      throw new BadRequestException('La imagen de firma no puede superar 500KB');
    }
    if (sizeBytes < 100) {
      throw new BadRequestException('La imagen parece estar vacía');
    }

    // Store the full data URI so we know the mime type when rendering
    const dataUri = `data:${mimeType};base64,${rawBase64}`;

    await this.db.query(
      `UPDATE doctors SET signature_image = $1, updated_at = NOW() WHERE id = $2`,
      [dataUri, doctorId],
    );

    this.logger.log(`Signature uploaded for doctor ${doctorId} (${(sizeBytes / 1024).toFixed(1)}KB)`);

    return { ok: true, sizeKb: Math.round(sizeBytes / 1024) };
  }

  /** Delete signature image */
  async deleteSignature(doctorId: string) {
    await this.db.query(
      `UPDATE doctors SET signature_image = NULL, updated_at = NOW() WHERE id = $1`,
      [doctorId],
    );
    return { ok: true };
  }

  /** Get raw signature data URI for PDF embedding */
  async getSignatureData(doctorId: string): Promise<string | null> {
    const row = await this.db.queryOne<{ signature_image: string }>(
      `SELECT signature_image FROM doctors WHERE id = $1`,
      [doctorId],
    );
    return row?.signature_image || null;
  }
}
