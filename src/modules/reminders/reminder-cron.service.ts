import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { PushNotificationService } from '../push/push.service';

/**
 * Servicio que ejecuta los recordatorios automáticos.
 * Llamado desde un endpoint interno (protegido por API key o IP local)
 * mediante cron en el VPS: curl -X POST http://localhost:3000/api/v1/internal/reminders/run
 */
@Injectable()
export class ReminderCronService {
  private readonly logger = new Logger(ReminderCronService.name);

  constructor(
    private db: DatabaseService,
    private push: PushNotificationService,
  ) {}

  /**
   * Enviar recordatorios de turnos del día siguiente.
   * Se ejecuta una vez al día (ej: 20:00), enviando recordatorios
   * para todos los turnos de mañana.
   */
  async sendTomorrowReminders(): Promise<{ sent: number; errors: number }> {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    this.logger.log(`Sending reminders for ${dateStr}...`);

    // Buscar turnos de mañana que estén confirmados y no cancelados
    const appointments = await this.db.queryMany(
      `SELECT a.id, a.date, a.start_time, a.patient_id, a.doctor_id,
              p.first_name || ' ' || p.last_name AS patient_name,
              d.first_name || ' ' || d.last_name AS doctor_name,
              o.name AS org_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN organization_doctors od ON od.id = a.org_doctor_id
       JOIN doctors d ON d.id = od.doctor_id
       JOIN organizations o ON o.id = od.organization_id
       WHERE a.date = $1::date
         AND a.status IN ('confirmed', 'scheduled')
         AND a.deleted_at IS NULL
       ORDER BY a.start_time`,
      [dateStr],
    );

    this.logger.log(`Found ${appointments.length} appointments for ${dateStr}`);

    let sent = 0;
    let errors = 0;

    for (const appt of appointments) {
      try {
        // Verificar si el doctor tiene recordatorios activados
        const settings = await this.db.queryOne(
          `SELECT appointment_reminder_enabled, appointment_reminder_push, quiet_hours_enabled
           FROM doctor_reminder_settings WHERE doctor_id = $1`,
          [appt.doctor_id],
        );

        // Si no tiene settings o tiene reminders habilitados (default true)
        const reminderEnabled = !settings || settings.appointment_reminder_enabled !== false;
        const pushEnabled = !settings || settings.appointment_reminder_push !== false;

        if (!reminderEnabled || !pushEnabled) {
          continue;
        }

        // Enviar recordatorio al paciente
        await this.push.sendToPatientByPatientId(appt.patient_id, {
          title: '📅 Turno mañana',
          body: `Recordá que tenés turno con Dr/a. ${appt.doctor_name} a las ${appt.start_time.substring(0, 5)} en ${appt.org_name}`,
          category: 'appointment_reminder',
          data: {
            type: 'appointment_reminder',
            appointmentId: appt.id,
            date: dateStr,
            startTime: appt.start_time,
          },
          sound: 'default',
        });

        sent++;
      } catch (err: any) {
        this.logger.error(`Failed to send reminder for appt ${appt.id}: ${err.message}`);
        errors++;
      }
    }

    // Enviar resumen diario a los doctores (si tienen activado)
    await this.sendDailySummaries(dateStr, appointments);

    this.logger.log(`Reminders complete: ${sent} sent, ${errors} errors`);
    return { sent, errors };
  }

  /**
   * Enviar resumen diario a cada doctor con turnos mañana
   */
  private async sendDailySummaries(dateStr: string, appointments: any[]) {
    // Agrupar por doctor
    const byDoctor = new Map<string, any[]>();
    for (const appt of appointments) {
      const list = byDoctor.get(appt.doctor_id) || [];
      list.push(appt);
      byDoctor.set(appt.doctor_id, list);
    }

    for (const [doctorId, docAppts] of byDoctor) {
      try {
        const settings = await this.db.queryOne(
          'SELECT daily_summary_enabled FROM doctor_reminder_settings WHERE doctor_id = $1',
          [doctorId],
        );

        if (settings && settings.daily_summary_enabled === false) continue;

        const count = docAppts.length;
        const first = docAppts[0].start_time.substring(0, 5);
        const last = docAppts[docAppts.length - 1].start_time.substring(0, 5);

        await this.push.sendToDoctor(doctorId, {
          title: `📊 Mañana: ${count} turno${count > 1 ? 's' : ''}`,
          body: `De ${first} a ${last}. Primer paciente: ${docAppts[0].patient_name}`,
          category: 'daily_summary',
          data: { type: 'daily_summary', date: dateStr, count },
        });
      } catch (err: any) {
        this.logger.error(`Failed to send daily summary to doctor ${doctorId}: ${err.message}`);
      }
    }
  }

  /**
   * Enviar recordatorios inmediatos (N minutos antes del turno).
   * Se ejecuta cada 15 minutos.
   */
  async sendUpcomingReminders(minutesBefore = 60): Promise<{ sent: number }> {
    const now = new Date();
    const windowStart = new Date(now.getTime() + (minutesBefore - 5) * 60000);
    const windowEnd = new Date(now.getTime() + (minutesBefore + 10) * 60000);
    const today = now.toISOString().split('T')[0];

    const appointments = await this.db.queryMany(
      `SELECT a.id, a.date, a.start_time, a.patient_id, a.doctor_id,
              p.first_name || ' ' || p.last_name AS patient_name,
              d.first_name || ' ' || d.last_name AS doctor_name,
              o.name AS org_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN organization_doctors od ON od.id = a.org_doctor_id
       JOIN doctors d ON d.id = od.doctor_id
       JOIN organizations o ON o.id = od.organization_id
       WHERE a.date = $1::date
         AND a.start_time::time BETWEEN $2::time AND $3::time
         AND a.status IN ('confirmed', 'scheduled')
         AND a.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM push_log pl
           WHERE pl.recipient_id = a.patient_id::text
             AND pl.category = 'appointment_reminder_immediate'
             AND pl.created_at > NOW() - INTERVAL '2 hours'
         )`,
      [today, windowStart.toTimeString().substring(0, 5), windowEnd.toTimeString().substring(0, 5)],
    );

    let sent = 0;
    for (const appt of appointments) {
      try {
        await this.push.notifyAppointmentReminder(appt.doctor_id, appt.patient_id, {
          date: appt.date,
          startTime: appt.start_time,
          patientName: appt.patient_name,
          doctorName: appt.doctor_name,
          orgName: appt.org_name,
        });
        sent++;
      } catch (err: any) {
        this.logger.error(`Upcoming reminder failed for appt ${appt.id}: ${err.message}`);
      }
    }

    return { sent };
  }
}
