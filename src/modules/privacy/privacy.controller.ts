import { UseGuards } from '@nestjs/common';
import { CaptchaGuard } from '../../common/guards/captcha.guard';
import { Controller, Get, Post, Body, Param, Query, Req, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { Public, AuthUser } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StrictThrottle } from '../../common/decorators/throttle.decorator';
import { DatabaseService } from '../../database/database.service';

/** Ley 25.326: derechos del titular de los datos (acceso, rectificación, supresión, oposición) */
@Controller('api/v1')
export class PrivacyController {
  constructor(private db: DatabaseService) {}

  /** Formulario público de la política de privacidad */
  @Public()
  @StrictThrottle()
  @UseGuards(CaptchaGuard)
  @Post('public/data-requests')
  async crear(@Body() b: any, @Req() req: Request) {
    const kind = String(b.kind || '');
    if (!['acceso', 'rectificacion', 'supresion', 'oposicion'].includes(kind)) throw new BadRequestException('Elegí qué querés pedir');
    if (!String(b.fullName || '').trim()) throw new BadRequestException('Ingresá tu nombre');
    if (String(b.dni || '').replace(/\D/g, '').length < 7) throw new BadRequestException('Ingresá tu DNI');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.email || ''))) throw new BadRequestException('Ingresá un email válido');
    const r = await this.db.queryOne(
      `INSERT INTO data_requests (requester_type, full_name, dni, email, kind, detail) VALUES ('public',$1,$2,$3,$4,$5) RETURNING id, due_at`,
      [String(b.fullName).trim(), String(b.dni).replace(/\D/g, ''), String(b.email).trim().toLowerCase(), kind, String(b.detail || '').slice(0, 2000) || null],
    );
    return { ok: true, numero: r.id.slice(0, 8).toUpperCase(), respondemosAntesDe: r.due_at };
  }

  /** El paciente logueado descarga todos sus datos (derecho de acceso, art. 14) */
  @Get('me/data-export')
  async exportar(@CurrentUser() u: AuthUser) {
    if (u.userType !== 'patient') throw new ForbiddenException('Disponible para pacientes');
    const auth = await this.db.queryOne(`SELECT patient_id FROM patient_auth WHERE id = $1`, [u.doctorId]);
    const pid = auth?.patient_id;
    if (!pid) throw new ForbiddenException();
    const q = (sql: string) => this.db.queryMany(sql, [pid]).catch(() => []);
    const [paciente, turnos, consultas, recetas] = await Promise.all([
      q(`SELECT first_name, last_name, dni, cuil, email, phone, date_of_birth, gender, address, city, province,
                insurance_provider, insurance_plan, insurance_number, allergies, chronic_conditions, current_medications, created_at
         FROM patients WHERE id = $1`),
      q(`SELECT a.date, a.start_time, a.status, a.reason, o.name AS consultorio FROM appointments a
         JOIN organizations o ON o.id = a.organization_id WHERE a.patient_id = $1 ORDER BY a.date DESC`),
      q(`SELECT date, doctor_full_name, chief_complaint, present_illness, diagnosis, diagnosis_code, treatment_plan, instructions,
                vital_signs, physical_exam, allergies, current_medications, personal_history, family_history, deleted_at, annulled_reason
         FROM medical_records WHERE patient_id = $1 ORDER BY date DESC`),
      q(`SELECT rx.issued_at, rx.cuir, rx.verification_code, rx.diagnosis, rx.status,
                (SELECT json_agg(json_build_object('generico', i.generic_name, 'presentacion', i.presentation, 'dosis', i.dosage, 'frecuencia', i.frequency))
                 FROM prescription_items i WHERE i.prescription_id = rx.id) AS items
         FROM prescriptions rx WHERE rx.patient_id = $1 ORDER BY rx.issued_at DESC`),
    ]);
    await this.db.query(
      `INSERT INTO data_requests (requester_type, patient_id, kind, status, response, resolved_at) VALUES ('patient',$1,'acceso','done','Descarga automática desde el portal',NOW())`,
      [pid],
    ).catch(() => undefined);
    return { generado: new Date(), responsable: 'TuConsultorioOnline by Rispy — contact@rispy.io', paciente: paciente[0] || null, turnos, consultas, recetas };
  }

  /** Recetas del paciente logueado (para mostrarlas en la farmacia desde el celular) */
  @Get('me/prescriptions')
  async misRecetas(@CurrentUser() u: AuthUser) {
    if (u.userType !== 'patient') throw new ForbiddenException('Disponible para pacientes');
    const auth = await this.db.queryOne(`SELECT patient_id FROM patient_auth WHERE id = $1`, [u.doctorId]);
    return this.db.queryMany(
      `SELECT rx.issued_at, rx.expires_at, rx.status, rx.cuir, rx.verification_code, rx.diagnosis,
              d.first_name || ' ' || d.last_name AS doctor_name, o.name AS consultorio,
              (SELECT json_agg(json_build_object('generico', COALESCE(i.generic_name, i.medication_name), 'presentacion', i.presentation,
                       'dosis', i.dosage, 'frecuencia', i.frequency) ORDER BY i.sort_order) FROM prescription_items i WHERE i.prescription_id = rx.id) AS items
       FROM prescriptions rx JOIN doctors d ON d.id = rx.doctor_id JOIN organizations o ON o.id = rx.organization_id
       WHERE rx.patient_id = $1 ORDER BY rx.issued_at DESC`, [auth?.patient_id]);
  }

  /** El paciente logueado pide rectificación / supresión / oposición */
  @Post('me/data-requests')
  async pedir(@CurrentUser() u: AuthUser, @Body() b: any) {
    if (u.userType !== 'patient') throw new ForbiddenException('Disponible para pacientes');
    const kind = String(b.kind || '');
    if (!['rectificacion', 'supresion', 'oposicion'].includes(kind)) throw new BadRequestException('Pedido inválido');
    const auth = await this.db.queryOne(`SELECT patient_id, email FROM patient_auth WHERE id = $1`, [u.doctorId]);
    const r = await this.db.queryOne(
      `INSERT INTO data_requests (requester_type, patient_id, email, kind, detail) VALUES ('patient',$1,$2,$3,$4) RETURNING id, due_at`,
      [auth?.patient_id, auth?.email, kind, String(b.detail || '').slice(0, 2000) || null],
    );
    return { ok: true, numero: r.id.slice(0, 8).toUpperCase(), respondemosAntesDe: r.due_at };
  }

  // ─── Administración ───
  private async admin(u: AuthUser) {
    const a = u.userType === 'doctor' ? await this.db.queryOne(`SELECT is_platform_admin FROM doctors WHERE id = $1`, [u.doctorId]) : null;
    if (!a?.is_platform_admin) throw new ForbiddenException('Solo administradores');
  }

  @Get('admin/data-requests')
  async listar(@CurrentUser() u: AuthUser, @Query('estado') estado?: string) {
    await this.admin(u);
    return this.db.queryMany(
      `SELECT r.*, p.first_name || ' ' || p.last_name AS patient_name FROM data_requests r LEFT JOIN patients p ON p.id = r.patient_id
       WHERE r.status = $1 ORDER BY r.created_at`, [estado || 'pending']);
  }

  @Post('admin/data-requests/:id/resolve')
  async resolver(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    await this.admin(u);
    await this.db.query(`UPDATE data_requests SET status = $2, response = $3, resolved_at = NOW() WHERE id = $1`,
      [id, b.status === 'rejected' ? 'rejected' : 'done', String(b.response || '').slice(0, 2000)]);
    return { ok: true };
  }
}
