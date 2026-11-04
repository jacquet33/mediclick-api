import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';
import { RefepsService } from './refeps.service';
import { EmailService } from '../email/email.service';

export interface SolicitudVerificacion {
  dni: string;
  medicalLicense: string;
  licenseType: 'MN' | 'MP';
  province?: string;
  specialty?: string;
  document?: string; // foto de la credencial (data URL)
  dniDocument?: string; // foto del DNI (data URL)
}

@Injectable()
export class VerificationService implements OnModuleInit {
  private readonly logger = new Logger(VerificationService.name);
  constructor(private db: DatabaseService, private refeps: RefepsService, private config: ConfigService, private email: EmailService) {}

  /** Administradores de la plataforma por variable PLATFORM_ADMIN_EMAILS (separados por coma) */
  async onModuleInit() {
    // Dueño de la plataforma: sus emails van como SHA-256 (el repo es público, así no quedan a la vista)
    const DUENO = [
      'c16196b4f51062d54b15f2246c6946db0aabe2a818be8b140e564b1dc54af15c',
      '0b4cb536ef7883db04b55ff1738a15d04b903b22070914eb0f3c4972be7b489e',
    ];
    await this.db.query(
      `UPDATE doctors SET is_platform_admin = true WHERE encode(sha256(convert_to(lower(email), 'UTF8')), 'hex') = ANY($1::text[])`,
      [DUENO],
    ).catch((e) => this.logger.warn(`Admins: ${e.message}`));
    const emails = String(this.config.get('PLATFORM_ADMIN_EMAILS') || '')
      .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (!emails.length) return;
    await this.db.query(`UPDATE doctors SET is_platform_admin = true WHERE lower(email) = ANY($1::text[])`, [emails])
      .catch((e) => this.logger.warn(`Admins: ${e.message}`));
  }

  async estado(doctorId: string) {
    const d = await this.db.queryOne(
      `SELECT first_name, last_name, dni, medical_license, medical_license_province, license_type, specialty,
              COALESCE(license_status, 'unverified') AS license_status, license_requested_at, license_verified_at,
              license_verified_by, license_verification_note, license_document IS NOT NULL AS has_document,
              signature_image IS NOT NULL AS has_signature, is_platform_admin
       FROM doctors WHERE id = $1`,
      [doctorId],
    );
    if (!d) throw new NotFoundException('Médico no encontrado');
    const pendienteMatricula = String(d.medical_license || '').startsWith('PENDING_');
    return {
      ...d,
      medical_license: pendienteMatricula ? '' : d.medical_license,
      puedeRecetar: d.license_status === 'verified',
      refepsAutomatico: this.refeps.disponible,
    };
  }

  async solicitar(doctorId: string, dto: SolicitudVerificacion) {
    const dni = String(dto.dni || '').replace(/\D/g, '');
    const matricula = String(dto.medicalLicense || '').trim();
    if (dni.length < 7 || dni.length > 9) throw new BadRequestException('Ingresá un DNI válido');
    if (!/^[A-Za-z0-9 .\-/]{2,30}$/.test(matricula)) throw new BadRequestException('Ingresá el número de matrícula');
    if (!['MN', 'MP'].includes(dto.licenseType)) throw new BadRequestException('Elegí si es matrícula nacional o provincial');
    if (dto.licenseType === 'MP' && !dto.province) throw new BadRequestException('Elegí la provincia de la matrícula');
    if (dto.document && (!/^data:image\/(jpeg|png|webp);base64,/.test(dto.document) || dto.document.length > 2_000_000)) {
      throw new BadRequestException('La foto de la credencial no es válida o es muy grande');
    }
    const otro = await this.db.queryOne(
      `SELECT id FROM doctors WHERE regexp_replace(COALESCE(dni,''),'\\D','','g') = $1 AND id <> $2 AND license_status IN ('verified','pending')`,
      [dni, doctorId],
    );
    if (otro) throw new BadRequestException('Ya hay otra cuenta de médico con ese DNI. Si es tuya, ingresá con esa cuenta o escribinos a support@tusrecetasmed.com');
    if (dto.dniDocument && (!/^data:image\/(jpeg|png|webp);base64,/.test(dto.dniDocument) || dto.dniDocument.length > 2_000_000)) {
      throw new BadRequestException('La foto del DNI no es válida o es muy grande');
    }
    if (dto.dniDocument) await this.db.query(`UPDATE doctors SET dni_document = $2 WHERE id = $1`, [doctorId, dto.dniDocument]);
    // La misma matrícula no puede estar verificada en otra cuenta
    const otra = await this.db.queryOne(
      `SELECT id FROM doctors WHERE id <> $1 AND license_status = 'verified'
         AND regexp_replace(medical_license, '\\D', '', 'g') = regexp_replace($2, '\\D', '', 'g')
         AND COALESCE(license_type, '') = $3 AND COALESCE(medical_license_province, '') = COALESCE($4, '')`,
      [doctorId, matricula, dto.licenseType, dto.licenseType === 'MP' ? dto.province : null],
    );
    if (otra) throw new BadRequestException('Esa matrícula ya está verificada en otra cuenta. Escribinos a support@tusrecetasmed.com');

    await this.db.query(
      `UPDATE doctors SET dni = $2, medical_license = $3, license_type = $4, medical_license_province = $5,
              specialty = COALESCE(NULLIF($6, ''), specialty),
              license_document = COALESCE($7, license_document),
              license_status = 'pending', license_requested_at = NOW(),
              license_verified_at = NULL, license_verified_by = NULL, license_verification_note = NULL,
              is_verified = false, updated_at = NOW()
       WHERE id = $1`,
      [doctorId, dni, matricula, dto.licenseType, dto.licenseType === 'MP' ? dto.province : null, dto.specialty || '', dto.document || null],
    );

    // Verificación automática contra REFEPS si hay credenciales SISA
    const r = await this.refeps.consultar(dni, matricula);
    if (r.consultado) {
      const ok = r.encontrado && r.esMedico && r.matriculaVigente && r.coincideMatricula;
      await this.db.query(
        `UPDATE doctors SET refeps_data = $2,
                license_status = CASE WHEN $3 THEN 'verified' ELSE 'pending' END,
                license_verified_at = CASE WHEN $3 THEN NOW() ELSE NULL END,
                license_verified_by = CASE WHEN $3 THEN 'refeps' ELSE NULL END,
                is_verified = $3,
                license_verification_note = $4
         WHERE id = $1`,
        [doctorId, JSON.stringify(r.raw || { error: r.error }), ok,
         ok ? 'Matrícula vigente en REFEPS' :
           r.error ? `REFEPS no respondió (${r.error}); queda para revisión manual` :
           !r.encontrado ? 'DNI no encontrado en REFEPS; queda para revisión manual' :
           !r.esMedico ? 'En REFEPS no figura como médico/a' :
           !r.coincideMatricula ? 'La matrícula no coincide con las registradas en REFEPS' : 'Matrícula no vigente en REFEPS'],
      );
      this.logger.log(`Verificación REFEPS ${doctorId}: ${ok ? 'OK' : 'revisión manual'}`);
      if (ok) this.avisarResultado(doctorId, true).catch(() => {});
    }
    return this.estado(doctorId);
  }

  // ─── Panel del administrador de la plataforma ──────────────

  private async mustAdmin(adminId: string) {
    const a = await this.db.queryOne(`SELECT email, is_platform_admin FROM doctors WHERE id = $1`, [adminId]);
    if (!a?.is_platform_admin) throw new ForbiddenException('Solo administradores de la plataforma');
    return a.email as string;
  }

  async pendientes(adminId: string, estado = 'pending') {
    await this.mustAdmin(adminId);
    return this.db.queryMany(
      `SELECT id, first_name, last_name, email, phone, dni, medical_license, license_type, medical_license_province,
              specialty, license_status, license_requested_at, license_verified_at, license_verified_by,
              license_verification_note, license_document, dni_document, refeps_data, created_at
       FROM doctors
       WHERE COALESCE(license_status, 'unverified') = $1
       ORDER BY license_requested_at DESC NULLS LAST, created_at DESC LIMIT 200`,
      [estado],
    );
  }

  async resolver(adminId: string, doctorId: string, aprobar: boolean, nota?: string) {
    const admin = await this.mustAdmin(adminId);
    const d = await this.db.queryOne(`SELECT id, medical_license FROM doctors WHERE id = $1`, [doctorId]);
    if (!d) throw new NotFoundException('Médico no encontrado');
    if (aprobar && (!d.medical_license || String(d.medical_license).startsWith('PENDING_'))) {
      throw new BadRequestException('El médico todavía no cargó su matrícula');
    }
    await this.db.query(
      `UPDATE doctors SET license_status = $2, is_verified = $3, license_verified_at = CASE WHEN $3 THEN NOW() ELSE NULL END,
              license_verified_by = $4, license_verification_note = $5, updated_at = NOW()
       WHERE id = $1`,
      [doctorId, aprobar ? 'verified' : 'rejected', aprobar, admin, nota || (aprobar ? 'Verificado manualmente (REFEPS / credencial)' : null)],
    );
    this.logger.log(`Matrícula de ${doctorId} ${aprobar ? 'aprobada' : 'rechazada'} por ${admin}`);
    this.avisarResultado(doctorId, aprobar, nota).catch((e) => this.logger.warn(`Aviso de verificación: ${e.message}`));
    return { ok: true };
  }

  /** Consulta previa para el alta: solo dice si el DNI figura como médico en REFEPS (sin datos personales) */
  async chequeoPublico(dni: string) {
    const d = String(dni || '').replace(/\D/g, '');
    if (d.length < 7 || d.length > 9) throw new BadRequestException('DNI inválido');
    const r = await this.refeps.consultar(d);
    return { consultado: r.consultado, encontrado: r.encontrado, esMedico: r.esMedico, matriculaVigente: r.matriculaVigente };
  }

  /** Para recetas: el médico tiene que estar verificado */
  async exigirVerificado(doctorId: string) {
    const d = await this.db.queryOne(`SELECT COALESCE(license_status, 'unverified') AS s FROM doctors WHERE id = $1`, [doctorId]);
    if (d?.s !== 'verified') {
      throw new ForbiddenException(
        d?.s === 'pending'
          ? 'Tu matrícula está en revisión. Vas a poder emitir recetas cuando quede verificada.'
          : 'Para emitir recetas primero verificá tu matrícula en Configuración → Matrícula y firma.',
      );
    }
  }

  /** Email al médico con el resultado de la verificación de su matrícula */
  private async avisarResultado(doctorId: string, aprobado: boolean, nota?: string) {
    const d = await this.db.queryOne(`SELECT email, first_name, last_name, title_prefix FROM doctors WHERE id = $1`, [doctorId]);
    if (!d?.email || !/@/.test(d.email)) return;
    const base = this.config.get<string>('BASE_URL') || 'https://tusrecetasmed.com';
    const nombre = [d.title_prefix || 'Dr./a', d.last_name || d.first_name].filter(Boolean).join(' ');
    const titulo = aprobado ? '¡Tu matrícula está verificada!' : 'Necesitamos revisar tus datos';
    const cuerpo = aprobado
      ? `<p style="font-size:15px;line-height:1.55;margin:0 0 12px">Validamos tu matrícula y <b>ya podés emitir recetas electrónicas</b> desde TusRecetasMed, en la web o en la app.</p>
         <ul style="font-size:15px;line-height:1.45;padding-left:20px;margin:0 0 16px"><li style="margin:6px 0">Cargá tu firma en <b>Configuración → Matrícula y firma</b> si todavía no lo hiciste.</li><li style="margin:6px 0">Compartí tu link de turnos con tus pacientes para que reserven online.</li></ul>`
      : `<p style="font-size:15px;line-height:1.55;margin:0 0 12px">No pudimos validar tu matrícula con los datos que cargaste.</p>
         ${nota ? `<p style="font-size:14px;line-height:1.5;background:#FFF6E5;border:1px solid #F1DFC0;border-radius:10px;padding:10px 12px;margin:0 0 14px"><b>Motivo:</b> ${esc(nota)}</p>` : ''}
         <p style="font-size:15px;line-height:1.55;margin:0 0 16px">Revisá el número y el tipo de matrícula y subí fotos <b>claras y legibles</b> del frente de tu DNI y de tu credencial (no selfies ni fotos borrosas).</p>`;
    const html = `<!doctype html><html><body style="margin:0;background:#F5F1EA;font-family:Helvetica,Arial,sans-serif;color:#2B241F">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1EA;padding:24px 0"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:linear-gradient(135deg,#9A6B3F,#3E7468);background-color:#6F4A2A;padding:28px 24px;text-align:center;color:#fff">
<div style="font-size:24px;font-weight:800">TusRecetas<span style="font-weight:500;color:#E7D9BE">Med</span></div></td></tr>
<tr><td style="padding:26px 28px">
<h1 style="font-size:21px;margin:0 0 6px;color:#3E7468">${titulo}</h1>
<p style="font-size:15px;margin:0 0 14px">Hola, ${esc(nombre)}:</p>
${cuerpo}
<p style="text-align:center;margin:0 0 18px"><a href="${base}/portal${aprobado ? '' : '#matricula'}" style="display:inline-block;background:#9A6B3F;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:12px">${aprobado ? 'Ir a mi consultorio' : 'Corregir mis datos'}</a></p>
<p style="font-size:13px;color:#7A6E62;line-height:1.5;margin:0">¿Dudas? Respondé este correo o escribinos a support@tusrecetasmed.com.</p>
</td></tr>
<tr><td style="padding:14px 28px;border-top:1px solid #F0E8DC;font-size:11px;color:#9A8B7A;text-align:center">TusRecetasMed · Colón, Entre Ríos, Argentina</td></tr>
</table></td></tr></table></body></html>`;
    await this.email.send({ to: d.email, subject: aprobado ? 'Ya podés emitir recetas en TusRecetasMed' : 'Revisá los datos de tu matrícula', html } as any);
  }
}

function esc(s: any) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)); }
