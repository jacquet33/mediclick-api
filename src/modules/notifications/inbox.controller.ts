import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/guards/auth.guard';
import { DatabaseService } from '../../database/database.service';

/** Campanita de la app: notificaciones del usuario logueado (turnos nuevos, solicitudes, cancelaciones…) */
@Controller('api/v1/notifications')
export class InboxController {
  constructor(private db: DatabaseService, private config: ConfigService) {}

  private quien(u: AuthUser) { return { tipo: u.userType === 'patient' ? 'patient' : u.userType === 'staff' ? 'staff' : 'doctor', id: u.doctorId }; }

  /** Turno y paciente de cada aviso (por appointmentId, o por la reserva online que lo generó) */
  private readonly JOIN_TURNO = `
      LEFT JOIN booking_requests br ON br.id = (CASE WHEN n.data->>'bookingRequestId' ~* '^[0-9a-f-]{36}$' THEN (n.data->>'bookingRequestId')::uuid END)
      LEFT JOIN appointments a ON a.id = COALESCE(CASE WHEN n.data->>'appointmentId' ~* '^[0-9a-f-]{36}$' THEN (n.data->>'appointmentId')::uuid END, br.appointment_id)
      LEFT JOIN patients p ON p.id = COALESCE(a.patient_id, CASE WHEN n.data->>'patientId' ~* '^[0-9a-f-]{36}$' THEN (n.data->>'patientId')::uuid END)`;

  @Get()
  async listar(@CurrentUser() u: AuthUser) {
    const q = this.quien(u);
    const rows = await this.db.queryMany<any>(
      `SELECT n.id, n.title, n.body, COALESCE(n.category, 'general') AS category, n.data, n.is_read, n.created_at,
              a.id AS appointment_id, p.id AS patient_id, p.dni, p.date_of_birth, p.gender, p.phone, p.email, p.insurance_provider, p.address,
              p.created_at AS patient_created_at
         FROM inbox_notifications n ${this.JOIN_TURNO}
        WHERE n.recipient_type = $1 AND n.recipient_id = $2
        ORDER BY n.created_at DESC LIMIT 60`, [q.tipo, q.id]);
    const notifications = rows.map((r) => ({
      id: r.id, title: r.title, body: r.body, category: r.category, data: r.data, is_read: r.is_read, created_at: r.created_at,
      appointment_id: r.appointment_id, patient_id: r.patient_id,
      perfil: r.patient_id ? perfilPaciente(r) : null,
    }));
    const unread = notifications.filter((n: any) => !n.is_read).length;
    return { notifications, unread };
  }

  @Get('unread-count')
  async noLeidas(@CurrentUser() u: AuthUser) {
    const q = this.quien(u);
    const r = await this.db.queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM inbox_notifications WHERE recipient_type = $1 AND recipient_id = $2 AND NOT is_read`, [q.tipo, q.id]);
    return { unread: r?.n || 0 };
  }

  @Put('mark-all-read')
  async todasLeidas(@CurrentUser() u: AuthUser) {
    const q = this.quien(u);
    await this.db.query(`UPDATE inbox_notifications SET is_read = true, read_at = now() WHERE recipient_type = $1 AND recipient_id = $2 AND NOT is_read`, [q.tipo, q.id]);
    return { ok: true };
  }

  @Put(':id/read')
  async leida(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const q = this.quien(u);
    await this.db.query(`UPDATE inbox_notifications SET is_read = true, read_at = now() WHERE id = $1 AND recipient_type = $2 AND recipient_id = $3`, [id, q.tipo, q.id]);
    return { ok: true };
  }

  /** Detalle de un aviso: lo marca como leído y devuelve el turno, el paciente y qué datos le faltan */
  @Get(':id')
  async detalle(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const q = this.quien(u);
    const r = await this.db.queryOne<any>(
      `SELECT n.id, n.title, n.body, COALESCE(n.category, 'general') AS category, n.data, n.created_at,
              a.id AS appointment_id, to_char(a.date, 'YYYY-MM-DD') AS appt_date, to_char(a.start_time, 'HH24:MI') AS appt_time,
              a.status AS appt_status, a.reason AS appt_reason, a.org_doctor_id,
              p.id AS patient_id, p.first_name, p.last_name, p.dni, to_char(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth, p.gender, p.phone, p.email,
              p.insurance_provider, p.insurance_plan, p.insurance_number, p.address, p.city, p.created_at AS patient_created_at,
              (SELECT count(*)::int FROM appointments x WHERE x.patient_id = p.id AND x.status NOT IN ('cancelled')) AS turnos_paciente,
              (SELECT bs.public_slug FROM booking_settings bs WHERE bs.org_doctor_id = a.org_doctor_id) AS slug
         FROM inbox_notifications n ${this.JOIN_TURNO}
        WHERE n.id = $1 AND n.recipient_type = $2 AND n.recipient_id = $3`, [id, q.tipo, q.id]);
    if (!r) throw new NotFoundException('Aviso no encontrado');
    await this.db.query(`UPDATE inbox_notifications SET is_read = true, read_at = COALESCE(read_at, now()) WHERE id = $1`, [id]);
    const base = this.config.get<string>('BASE_URL') || 'https://tusrecetasmed.com';
    return {
      id: r.id, title: r.title, body: r.body, category: r.category, created_at: r.created_at,
      turno: r.appointment_id ? { id: r.appointment_id, fecha: r.appt_date, hora: r.appt_time, estado: r.appt_status, motivo: r.appt_reason } : null,
      paciente: r.patient_id ? {
        id: r.patient_id, first_name: r.first_name, last_name: r.last_name, dni: r.dni, date_of_birth: r.date_of_birth, gender: r.gender,
        phone: r.phone, email: r.email, insurance_provider: r.insurance_provider, insurance_plan: r.insurance_plan, insurance_number: r.insurance_number,
        address: r.address, city: r.city, turnos: r.turnos_paciente,
      } : null,
      perfil: r.patient_id ? perfilPaciente(r) : null,
      link_completar: r.slug ? `${base}/registro/${r.slug}` : null,
    };
  }
}

/**
 * Qué tan completo está el perfil del paciente:
 * verde = todo cargado · amarillo = le falta algo · rojo = paciente nuevo casi sin datos (o sin DNI ni fecha de nacimiento)
 */
export function perfilPaciente(p: any): { estado: 'verde' | 'amarillo' | 'rojo'; faltan: string[]; nuevo: boolean } {
  const vacio = (v: any) => v === null || v === undefined || String(v).trim() === '';
  const faltan: string[] = [];
  if (vacio(p.dni)) faltan.push('DNI');
  if (vacio(p.date_of_birth)) faltan.push('Fecha de nacimiento');
  if (vacio(p.gender) || p.gender === 'not_specified') faltan.push('Sexo');
  if (vacio(p.phone)) faltan.push('Teléfono');
  if (vacio(p.email)) faltan.push('Email');
  if (p.insurance_provider === null || p.insurance_provider === undefined) faltan.push('Cobertura médica');
  if (vacio(p.address)) faltan.push('Domicilio');
  const nuevo = !!p.patient_created_at && Date.now() - new Date(p.patient_created_at).getTime() < 30 * 86400_000;
  const estado = faltan.length === 0 ? 'verde'
    : faltan.length >= 4 || (faltan.includes('DNI') && faltan.includes('Fecha de nacimiento')) ? 'rojo' : 'amarillo';
  return { estado, faltan, nuevo };
}
