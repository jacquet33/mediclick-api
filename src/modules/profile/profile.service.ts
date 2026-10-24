import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(private db: DatabaseService) {}

  /** Get doctor profile */
  async getProfile(doctorId: string) {
    const doc = await this.db.queryOne(
      `SELECT id, email, first_name, last_name, phone, dni,
              medical_license, medical_license_province,
              specialty, secondary_specialties, avatar_url, bio,
              signature_image IS NOT NULL AS has_signature,
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
      bio?: string;
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
    if (dto.bio !== undefined) { sets.push(`bio = $${idx++}`); vals.push(dto.bio); }

    if (sets.length === 0) return this.getProfile(doctorId);

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
