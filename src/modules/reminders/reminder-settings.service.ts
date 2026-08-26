import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export interface UpdateReminderSettingsDto {
  // Turnos
  appointmentReminderEnabled?: boolean;
  appointmentReminderMinutes?: number[];
  appointmentReminderPush?: boolean;
  appointmentReminderEmail?: boolean;

  // Resumen diario
  dailySummaryEnabled?: boolean;
  dailySummaryTime?: string;       // "HH:MM"
  dailySummaryDays?: number[];     // 0=dom..6=sáb

  // Mensajes
  newMessageEnabled?: boolean;
  newMessagePush?: boolean;
  newMessageSound?: boolean;

  // Recetas
  prescriptionExpiryEnabled?: boolean;
  prescriptionExpiryDays?: number;

  // Cancelaciones
  cancellationAlertEnabled?: boolean;
  noShowAlertEnabled?: boolean;

  // Horario silencioso
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;        // "HH:MM"
  quietHoursEnd?: string;          // "HH:MM"

  // Conflictos
  crossOrgConflictEnabled?: boolean;
}

@Injectable()
export class ReminderSettingsService {
  private readonly logger = new Logger(ReminderSettingsService.name);

  constructor(private db: DatabaseService) {}

  /** Obtener o crear settings del doctor */
  async getSettings(doctorId: string) {
    // Upsert: si no existen, crearlos con defaults
    const settings = await this.db.queryOne(
      `INSERT INTO doctor_reminder_settings (doctor_id)
       VALUES ($1)
       ON CONFLICT (doctor_id) DO UPDATE SET doctor_id = $1
       RETURNING *`,
      [doctorId],
    );

    return this.formatResponse(settings);
  }

  /** Actualizar settings */
  async updateSettings(doctorId: string, dto: UpdateReminderSettingsDto) {
    // Asegurar que exista
    await this.db.query(
      `INSERT INTO doctor_reminder_settings (doctor_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [doctorId],
    );

    const mapping: Record<string, string> = {
      appointmentReminderEnabled: 'appointment_reminder_enabled',
      appointmentReminderMinutes: 'appointment_reminder_minutes',
      appointmentReminderPush: 'appointment_reminder_push',
      appointmentReminderEmail: 'appointment_reminder_email',
      dailySummaryEnabled: 'daily_summary_enabled',
      dailySummaryTime: 'daily_summary_time',
      dailySummaryDays: 'daily_summary_days',
      newMessageEnabled: 'new_message_enabled',
      newMessagePush: 'new_message_push',
      newMessageSound: 'new_message_sound',
      prescriptionExpiryEnabled: 'prescription_expiry_enabled',
      prescriptionExpiryDays: 'prescription_expiry_days',
      cancellationAlertEnabled: 'cancellation_alert_enabled',
      noShowAlertEnabled: 'no_show_alert_enabled',
      quietHoursEnabled: 'quiet_hours_enabled',
      quietHoursStart: 'quiet_hours_start',
      quietHoursEnd: 'quiet_hours_end',
      crossOrgConflictEnabled: 'cross_org_conflict_enabled',
    };

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, column] of Object.entries(mapping)) {
      if (dto[key] !== undefined) {
        fields.push(`${column} = $${idx}`);
        values.push(dto[key]);
        idx++;
      }
    }

    if (fields.length === 0) {
      return this.getSettings(doctorId);
    }

    values.push(doctorId);
    const result = await this.db.queryOne(
      `UPDATE doctor_reminder_settings SET ${fields.join(', ')} WHERE doctor_id = $${idx} RETURNING *`,
      values,
    );

    this.logger.log(`Reminder settings updated for doctor ${doctorId}: ${fields.length} fields`);
    return this.formatResponse(result);
  }

  /** Formato camelCase para el frontend */
  private formatResponse(row: any) {
    if (!row) return null;
    return {
      id: row.id,
      doctorId: row.doctor_id,
      appointmentReminderEnabled: row.appointment_reminder_enabled,
      appointmentReminderMinutes: row.appointment_reminder_minutes,
      appointmentReminderPush: row.appointment_reminder_push,
      appointmentReminderEmail: row.appointment_reminder_email,
      dailySummaryEnabled: row.daily_summary_enabled,
      dailySummaryTime: row.daily_summary_time?.substring(0, 5) ?? '08:00',
      dailySummaryDays: row.daily_summary_days,
      newMessageEnabled: row.new_message_enabled,
      newMessagePush: row.new_message_push,
      newMessageSound: row.new_message_sound,
      prescriptionExpiryEnabled: row.prescription_expiry_enabled,
      prescriptionExpiryDays: row.prescription_expiry_days,
      cancellationAlertEnabled: row.cancellation_alert_enabled,
      noShowAlertEnabled: row.no_show_alert_enabled,
      quietHoursEnabled: row.quiet_hours_enabled,
      quietHoursStart: row.quiet_hours_start?.substring(0, 5) ?? '22:00',
      quietHoursEnd: row.quiet_hours_end?.substring(0, 5) ?? '07:00',
      crossOrgConflictEnabled: row.cross_org_conflict_enabled,
    };
  }
}
