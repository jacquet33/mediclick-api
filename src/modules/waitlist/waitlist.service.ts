import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export interface AddToWaitlistDto {
  patientId?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  desiredDate: string;           // YYYY-MM-DD
  preferredStartTime?: string;   // HH:MM
  preferredEndTime?: string;     // HH:MM
  reason?: string;
  priority?: number;
  notifyPush?: boolean;
  notifySms?: boolean;
  notifyEmail?: boolean;
}

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(private db: DatabaseService) {}

  // ═══════════════════════════════════════════════════════════
  // GESTIÓN (médico/secretaria)
  // ═══════════════════════════════════════════════════════════

  /** Agregar a lista de espera */
  async add(orgId: string, doctorId: string, dto: AddToWaitlistDto) {
    const orgDoctorId = await this.getOrgDoctorId(orgId, doctorId);

    // Resolver nombre del contacto
    let contactName = dto.contactName;
    let contactPhone = dto.contactPhone;
    let contactEmail = dto.contactEmail;

    if (dto.patientId) {
      const p = await this.db.queryOne(
        `SELECT first_name || ' ' || last_name AS name, phone, email FROM patients WHERE id = $1`,
        [dto.patientId],
      );
      if (p) {
        contactName = contactName || p.name;
        contactPhone = contactPhone || p.phone;
        contactEmail = contactEmail || p.email;
      }
    }

    const entry = await this.db.queryOne(
      `INSERT INTO waitlist (
        organization_id, org_doctor_id, patient_id,
        contact_name, contact_phone, contact_email,
        desired_date, preferred_start_time, preferred_end_time,
        reason, priority, notify_push, notify_sms, notify_email,
        expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12,$13,$14,
        ($7::date + INTERVAL '1 day')::timestamptz
      ) RETURNING *`,
      [
        orgId, orgDoctorId, dto.patientId || null,
        contactName, contactPhone, contactEmail,
        dto.desiredDate, dto.preferredStartTime || null, dto.preferredEndTime || null,
        dto.reason || null, dto.priority || 50,
        dto.notifyPush ?? true, dto.notifySms ?? false, dto.notifyEmail ?? false,
      ],
    );

    this.logger.log(`Waitlist entry: ${entry.id} for ${dto.desiredDate} (${contactName})`);
    return entry;
  }

  /** Lista de espera de un doctor */
  async list(orgId: string, doctorId: string, filters?: { date?: string; status?: string }) {
    const orgDoctorId = await this.getOrgDoctorId(orgId, doctorId);

    let query = `
      SELECT w.*,
        p.first_name || ' ' || p.last_name AS patient_name,
        p.phone AS patient_phone
      FROM waitlist w
      LEFT JOIN patients p ON p.id = w.patient_id
      WHERE w.org_doctor_id = $1
    `;
    const params: any[] = [orgDoctorId];

    if (filters?.date) {
      params.push(filters.date);
      query += ` AND w.desired_date = $${params.length}::date`;
    }

    if (filters?.status) {
      params.push(filters.status);
      query += ` AND w.status = $${params.length}`;
    } else {
      query += ` AND w.status = 'waiting'`;
    }

    query += ` ORDER BY w.priority ASC, w.created_at ASC`;
    return this.db.queryMany(query, params);
  }

  /** Cancelar entrada de la lista de espera */
  async cancel(orgId: string, entryId: string) {
    const entry = await this.db.queryOne(
      `UPDATE waitlist SET status = 'cancelled'
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [entryId, orgId],
    );
    if (!entry) throw new NotFoundException('Entrada no encontrada');
    return entry;
  }

  /** Convertir entrada en turno confirmado */
  async bookFromWaitlist(orgId: string, doctorId: string, entryId: string, startTime: string, endTime: string) {
    const orgDoctorId = await this.getOrgDoctorId(orgId, doctorId);
    const entry = await this.db.queryOne(
      `SELECT * FROM waitlist WHERE id = $1 AND organization_id = $2 AND status IN ('waiting', 'notified')`,
      [entryId, orgId],
    );
    if (!entry) throw new NotFoundException('Entrada no encontrada o ya procesada');

    return this.db.transaction(async (client) => {
      // Crear paciente si no existe
      let patientId = entry.patient_id;
      if (!patientId && entry.contact_name) {
        const names = entry.contact_name.split(' ');
        const firstName = names[0] || 'Sin';
        const lastName = names.slice(1).join(' ') || 'Nombre';
        const newP = await client.query(
          `INSERT INTO patients (organization_id, first_name, last_name, phone, email)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [orgId, firstName, lastName, entry.contact_phone, entry.contact_email],
        );
        patientId = newP.rows[0].id;
      }

      // Crear turno
      const appt = await client.query(
        `INSERT INTO appointments (organization_id, org_doctor_id, patient_id,
          date, start_time, end_time, status, reason, is_first_visit)
         VALUES ($1,$2,$3,$4::date,$5::time,$6::time,'confirmed',$7,$8)
         RETURNING *`,
        [orgId, orgDoctorId, patientId, entry.desired_date, startTime, endTime,
         entry.reason, !entry.patient_id],
      );

      // Marcar como reservado
      await client.query(
        `UPDATE waitlist SET status = 'booked', booked_appointment_id = $1 WHERE id = $2`,
        [appt.rows[0].id, entryId],
      );

      return { appointment: appt.rows[0], waitlistEntry: entry };
    });
  }

  // ═══════════════════════════════════════════════════════════
  // AUTO-NOTIFICACIÓN (llamado cuando se cancela un turno)
  // ═══════════════════════════════════════════════════════════

  /** Buscar y notificar personas en espera cuando se libera un slot */
  async onSlotReleased(orgDoctorId: string, date: string, startTime: string, endTime: string, cancelledApptId?: string) {
    // Buscar todos los que esperan para esa fecha + doctor
    const waiters = await this.db.queryMany(
      `SELECT * FROM waitlist
       WHERE org_doctor_id = $1
         AND desired_date = $2::date
         AND status = 'waiting'
         AND (preferred_start_time IS NULL
              OR ($3::time >= preferred_start_time AND $3::time < COALESCE(preferred_end_time, '23:59'::time)))
       ORDER BY priority ASC, created_at ASC`,
      [orgDoctorId, date, startTime],
    );

    if (waiters.length === 0) {
      this.logger.log(`No waiters for ${date} ${startTime}`);
      return { notified: 0 };
    }

    const holdMinutes = 15;
    const holdUntil = new Date(Date.now() + holdMinutes * 60000);
    let notifiedCount = 0;

    for (const w of waiters) {
      // Crear notificación de slot liberado
      await this.db.query(
        `INSERT INTO slot_release_notifications
          (waitlist_id, org_doctor_id, released_date, released_start_time, released_end_time,
           cancelled_appointment_id, notification_sent, sent_at, hold_until)
         VALUES ($1,$2,$3::date,$4::time,$5::time,$6,true,NOW(),$7)`,
        [w.id, orgDoctorId, date, startTime, endTime, cancelledApptId || null, holdUntil.toISOString()],
      );

      // Marcar como notificado
      await this.db.query(
        `UPDATE waitlist SET status = 'notified', notified_at = NOW(), notified_slot_time = $1::time WHERE id = $2`,
        [startTime, w.id],
      );

      // Crear notificación interna
      const orgDoctor = await this.db.queryOne(
        `SELECT doctor_id, organization_id FROM organization_doctors WHERE id = $1`,
        [orgDoctorId],
      );

      if (orgDoctor) {
        await this.db.query(
          `INSERT INTO notifications (organization_id, recipient_type, recipient_id, type, title, body, data)
           VALUES ($1, 'doctor', $2, 'appointment_reminder',
             'Turno liberado — Lista de espera',
             $3, $4)`,
          [
            orgDoctor.organization_id, orgDoctor.doctor_id,
            `Se liberó ${startTime}hs el ${date}. ${w.contact_name || 'Paciente'} fue notificado.`,
            JSON.stringify({ waitlistId: w.id, date, startTime, endTime }),
          ],
        );
      }

      notifiedCount++;
      this.logger.log(`Waitlist notified: ${w.contact_name} for ${date} ${startTime}`);
    }

    return { notified: notifiedCount, date, startTime };
  }

  // ═══════════════════════════════════════════════════════════
  // PÚBLICO (paciente pide ser notificado desde booking)
  // ═══════════════════════════════════════════════════════════

  async addPublic(slug: string, dto: {
    firstName: string; lastName: string; phone: string; email?: string;
    desiredDate: string; preferredStartTime?: string; preferredEndTime?: string; reason?: string;
  }) {
    const profile = await this.db.queryOne(
      `SELECT * FROM v_public_doctor_profile WHERE public_slug = $1`,
      [slug],
    );
    if (!profile) throw new NotFoundException('Médico no encontrado');

    return this.add(profile.organization_id, profile.doctor_id, {
      contactName: `${dto.firstName} ${dto.lastName}`,
      contactPhone: dto.phone,
      contactEmail: dto.email,
      desiredDate: dto.desiredDate,
      preferredStartTime: dto.preferredStartTime,
      preferredEndTime: dto.preferredEndTime,
      reason: dto.reason,
      notifyPush: false,
      notifySms: true,
      notifyEmail: !!dto.email,
    });
  }

  /** Estadísticas de la lista de espera */
  async stats(orgId: string, doctorId: string) {
    const orgDoctorId = await this.getOrgDoctorId(orgId, doctorId);

    const result = await this.db.queryOne(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'waiting') AS waiting,
        COUNT(*) FILTER (WHERE status = 'notified') AS notified,
        COUNT(*) FILTER (WHERE status = 'booked') AS booked,
        COUNT(*) FILTER (WHERE status = 'expired') AS expired,
        COUNT(*) FILTER (WHERE status = 'waiting' AND desired_date = CURRENT_DATE) AS waiting_today,
        COUNT(*) FILTER (WHERE status = 'waiting' AND desired_date = CURRENT_DATE + 1) AS waiting_tomorrow
       FROM waitlist WHERE org_doctor_id = $1`,
      [orgDoctorId],
    );
    return result;
  }

  // ─── Helper ────────────────────────────────────────────

  private async getOrgDoctorId(orgId: string, doctorId: string): Promise<string> {
    const r = await this.db.queryOne(
      `SELECT id FROM organization_doctors WHERE organization_id = $1 AND doctor_id = $2 AND is_active = true`,
      [orgId, doctorId],
    );
    if (!r) throw new NotFoundException('Doctor no pertenece a esta organización');
    return r.id;
  }
}
