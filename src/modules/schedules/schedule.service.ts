import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export interface SetScheduleDto {
  doctorId: string;
  schedules: {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    slotDurationMinutes?: number;
    maxPatientsPerSlot?: number;
  }[];
}

export interface AddExceptionDto {
  doctorId: string;
  date: string;
  isAvailable?: boolean;
  startTime?: string;
  endTime?: string;
  reason?: string;
}

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(private db: DatabaseService) {}

  /**
   * Días en que se puede dar turno entre `from` y `to` (YYYY-MM-DD): días de la semana con horario
   * y fechas bloqueadas por excepciones (feriados, ausencias). Lo usan la página de reservas y las apps
   * para mostrar en gris los días sin atención.
   */
  async diasConAtencion(orgDoctorId: string, from?: string, to?: string) {
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const ok = (x?: string) => !!x && /^\d{4}-\d{2}-\d{2}$/.test(x);
    const desde = ok(from) ? from! : iso(new Date());
    const hasta = ok(to) ? to! : iso(new Date(Date.now() + 120 * 86400000));
    const dias = await this.db.queryMany<{ day_of_week: number }>(
      `SELECT DISTINCT day_of_week FROM doctor_schedules WHERE org_doctor_id = $1 AND is_active = true ORDER BY day_of_week`,
      [orgDoctorId],
    );
    const excepciones = await this.db.queryMany<{ date: string; is_available: boolean }>(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date, is_available FROM schedule_exceptions
        WHERE org_doctor_id = $1 AND date BETWEEN $2::date AND $3::date`,
      [orgDoctorId, desde, hasta],
    );
    return {
      weekdays: dias.map((d) => Number(d.day_of_week)),           // 0 = domingo … 6 = sábado
      blockedDates: excepciones.filter((e) => !e.is_available).map((e) => e.date),
      from: desde,
      to: hasta,
    };
  }

  async diasDelMedico(orgId: string, doctorId: string, from?: string, to?: string) {
    return this.diasConAtencion(await this.getOrgDoctorId(orgId, doctorId), from, to);
  }

  async getSchedules(orgId: string, doctorId: string) {
    const orgDoctorId = await this.getOrgDoctorId(orgId, doctorId);
    return this.db.queryMany(
      `SELECT * FROM doctor_schedules WHERE org_doctor_id = $1 AND is_active = true ORDER BY day_of_week`,
      [orgDoctorId],
    );
  }

  async setSchedules(orgId: string, dto: SetScheduleDto) {
    const orgDoctorId = await this.getOrgDoctorId(orgId, dto.doctorId);
    for (const x of dto.schedules || []) {
      if (!(x.dayOfWeek >= 0 && x.dayOfWeek <= 6)) throw new BadRequestException('Día inválido (0 = domingo … 6 = sábado)');
      if (!/^\d{2}:\d{2}/.test(x.startTime || '') || !/^\d{2}:\d{2}/.test(x.endTime || '') || x.startTime >= x.endTime) {
        throw new BadRequestException('Revisá los horarios: el inicio tiene que ser antes del fin');
      }
    }

    return this.db.transaction(async (client) => {
      await client.query(
        `UPDATE doctor_schedules SET is_active = false WHERE org_doctor_id = $1`,
        [orgDoctorId],
      );

      for (const s of dto.schedules) {
        await client.query(
          `INSERT INTO doctor_schedules (org_doctor_id, day_of_week, start_time, end_time, slot_duration_minutes, max_patients_per_slot)
           VALUES ($1, $2, $3::time, $4::time, $5, $6)
           ON CONFLICT (org_doctor_id, day_of_week) WHERE is_active = true
           DO UPDATE SET start_time = $3::time, end_time = $4::time, slot_duration_minutes = $5, max_patients_per_slot = $6, is_active = true`,
          [orgDoctorId, s.dayOfWeek, s.startTime, s.endTime, s.slotDurationMinutes || 30, s.maxPatientsPerSlot || 1],
        );
      }

      return { message: 'Horarios actualizados' };
    });
  }

  async getExceptions(orgId: string, doctorId: string, from?: string, to?: string) {
    const orgDoctorId = await this.getOrgDoctorId(orgId, doctorId);
    let query = `SELECT * FROM schedule_exceptions WHERE org_doctor_id = $1`;
    const params: any[] = [orgDoctorId];
    let idx = 2;

    if (from) { query += ` AND date >= $${idx}::date`; params.push(from); idx++; }
    if (to) { query += ` AND date <= $${idx}::date`; params.push(to); idx++; }

    return this.db.queryMany(query + ' ORDER BY date', params);
  }

  async addException(orgId: string, dto: AddExceptionDto) {
    const orgDoctorId = await this.getOrgDoctorId(orgId, dto.doctorId);
    return this.db.queryOne(
      `INSERT INTO schedule_exceptions (org_doctor_id, date, is_available, start_time, end_time, reason)
       VALUES ($1, $2::date, $3, $4, $5, $6)
       RETURNING *`,
      [orgDoctorId, dto.date, dto.isAvailable ?? false, dto.startTime, dto.endTime, dto.reason],
    );
  }

  async deleteException(orgId: string, id: string) {
    // Solo excepciones de médicos de este consultorio
    await this.db.query(
      `DELETE FROM schedule_exceptions se USING organization_doctors od
       WHERE se.id = $1 AND od.id = se.org_doctor_id AND od.organization_id = $2`,
      [id, orgId],
    );
    return { message: 'Excepción eliminada' };
  }

  private async getOrgDoctorId(orgId: string, doctorId: string): Promise<string> {
    const r = await this.db.queryOne(
      `SELECT id FROM organization_doctors WHERE organization_id = $1 AND doctor_id = $2 AND is_active = true`,
      [orgId, doctorId],
    );
    if (!r) throw new BadRequestException('El médico no pertenece a este consultorio');
    return r.id;
  }
}
