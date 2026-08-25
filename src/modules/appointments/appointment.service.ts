import { Injectable, BadRequestException, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { OrganizationService } from '../organizations/organization.service';

// ─── DTOs ───────────────────────────────────────────────────

export interface CreateAppointmentDto {
  patientId: string;
  doctorId: string;         // El doctor que atiende
  date: string;             // "2026-08-28"
  startTime: string;        // "09:30"
  endTime: string;          // "10:00"
  reason?: string;
  isFirstVisit?: boolean;
  isOnline?: boolean;
  roomNumber?: string;
}

export interface ConflictDetail {
  appointmentId: string;
  organizationId: string;
  organizationName: string;
  patientName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
}

export interface ConflictCheckResult {
  hasConflict: boolean;
  conflicts: ConflictDetail[];
}

export interface AvailableSlot {
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  conflictOrg?: string;     // Si está ocupado, en qué org
}

@Injectable()
export class AppointmentService {
  private readonly logger = new Logger(AppointmentService.name);

  constructor(
    private db: DatabaseService,
    private orgService: OrganizationService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // DETECCIÓN DE CONFLICTOS CROSS-CONSULTORIO
  // ═══════════════════════════════════════════════════════════

  /**
   * Busca conflictos de horario para un doctor en TODAS sus organizaciones.
   * 
   * Un conflicto existe cuando:
   *   - Mismo doctor
   *   - Misma fecha
   *   - Los rangos horarios se superponen (parcial o total)
   *   - El turno existente NO está cancelado ni fue no-show
   * 
   * Excluye opcionalmente un appointmentId (para edición de turnos).
   */
  async checkConflicts(
    doctorId: string,
    date: string,
    startTime: string,
    endTime: string,
    excludeAppointmentId?: string,
  ): Promise<ConflictCheckResult> {
    
    const query = `
      SELECT 
        a.id AS appointment_id,
        a.organization_id,
        o.name AS organization_name,
        p.first_name || ' ' || p.last_name AS patient_name,
        a.date::text,
        a.start_time::text,
        a.end_time::text,
        a.status
      FROM appointments a
      JOIN organization_doctors od ON od.id = a.org_doctor_id
      JOIN organizations o ON o.id = a.organization_id
      JOIN patients p ON p.id = a.patient_id
      WHERE od.doctor_id = $1                           -- Mismo doctor
        AND a.date = $2::date                           -- Misma fecha
        AND a.status NOT IN ('cancelled', 'no_show')    -- Turnos activos
        AND (
          -- Superposición de rangos: A empieza antes de que B termine
          -- Y A termina después de que B empiece
          (a.start_time < $4::time AND a.end_time > $3::time)
        )
        ${excludeAppointmentId ? 'AND a.id != $5' : ''}
      ORDER BY a.start_time
    `;

    const params = excludeAppointmentId
      ? [doctorId, date, startTime, endTime, excludeAppointmentId]
      : [doctorId, date, startTime, endTime];

    const conflicts = await this.db.queryMany<ConflictDetail>(query, params);

    return {
      hasConflict: conflicts.length > 0,
      conflicts,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // CREAR TURNO (con validación de conflictos)
  // ═══════════════════════════════════════════════════════════

  /**
   * Crea un turno nuevo.
   * 
   * Flujo:
   *   1. Validar que el doctor pertenece a la org
   *   2. Validar que el paciente pertenece a la org
   *   3. Verificar conflictos cross-org
   *   4. Si hay conflicto → error con detalle
   *   5. Si no hay conflicto → crear turno
   *   6. Crear notificación para el paciente
   */
  async create(
    organizationId: string,
    createdById: string,
    createdByType: 'doctor' | 'secretary',
    dto: CreateAppointmentDto,
    forceCreate: boolean = false,     // Forzar creación ignorando conflictos
  ) {
    // 1. Obtener org_doctor_id
    const orgDoctorId = await this.orgService.getOrgDoctorId(organizationId, dto.doctorId);

    // 2. Validar paciente pertenece a la org
    const patient = await this.db.queryOne(
      'SELECT id, first_name, last_name FROM patients WHERE id = $1 AND organization_id = $2 AND is_active = true',
      [dto.patientId, organizationId],
    );
    if (!patient) {
      throw new NotFoundException('Paciente no encontrado en esta organización');
    }

    // 3. Validar que la hora no sea pasada
    const appointmentDateTime = new Date(`${dto.date}T${dto.startTime}:00`);
    if (appointmentDateTime < new Date()) {
      throw new BadRequestException('No se puede crear un turno en el pasado');
    }

    // 4. Validar que startTime < endTime
    if (dto.startTime >= dto.endTime) {
      throw new BadRequestException('La hora de inicio debe ser anterior a la hora de fin');
    }

    // 5. VERIFICAR CONFLICTOS CROSS-ORG
    const conflictCheck = await this.checkConflicts(
      dto.doctorId,
      dto.date,
      dto.startTime,
      dto.endTime,
    );

    if (conflictCheck.hasConflict && !forceCreate) {
      // Devolver error con detalle de los conflictos
      const conflictMessages = conflictCheck.conflicts.map(c =>
        `${c.startTime.substring(0, 5)}-${c.endTime.substring(0, 5)} en "${c.organizationName}" con ${c.patientName} (${c.status})`
      );

      throw new ConflictException({
        message: 'El doctor tiene turnos que se superponen en otro/s consultorio/s',
        conflicts: conflictCheck.conflicts,
        conflictSummary: conflictMessages,
        hint: 'Podés forzar la creación enviando forceCreate: true, o elegir otro horario',
      });
    }

    // 6. Crear el turno
    const appointment = await this.db.queryOne(
      `INSERT INTO appointments (
        organization_id, org_doctor_id, patient_id,
        date, start_time, end_time,
        status, reason, is_first_visit, is_online, room_number,
        created_by_type, created_by_id
      ) VALUES ($1, $2, $3, $4, $5::time, $6::time, 'pending', $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        organizationId, orgDoctorId, dto.patientId,
        dto.date, dto.startTime, dto.endTime,
        dto.reason, dto.isFirstVisit || false, dto.isOnline || false, dto.roomNumber,
        createdByType, createdById,
      ],
    );

    // 7. Notificar al paciente (si tiene auth)
    await this.createNotification(
      dto.patientId,
      'appointment_confirmed',
      'Turno confirmado',
      `Tenés turno el ${dto.date} a las ${dto.startTime}`,
      { appointmentId: appointment.id, organizationId },
    );

    // 8. Si se forzó la creación con conflictos, notificar al doctor
    if (conflictCheck.hasConflict && forceCreate) {
      await this.createNotification(
        dto.doctorId,
        'appointment_reminder',
        'Turno con superposición',
        `Se creó un turno el ${dto.date} a las ${dto.startTime} en "${(await this.getOrgName(organizationId))}" que se superpone con otro consultorio`,
        {
          appointmentId: appointment.id,
          conflicts: conflictCheck.conflicts,
          type: 'forced_overlap',
        },
      );
    }

    this.logger.log(`Appointment created: ${appointment.id} (${dto.date} ${dto.startTime}) ${forceCreate ? '[FORCED]' : ''}`);

    return {
      appointment,
      warnings: conflictCheck.hasConflict ? {
        message: 'Turno creado con superposición forzada',
        conflicts: conflictCheck.conflicts,
      } : null,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // HORARIOS DISPONIBLES (considerando TODAS las orgs)
  // ═══════════════════════════════════════════════════════════

  /**
   * Obtener slots disponibles para un doctor en una fecha.
   * Cruza los horarios configurados para esta org con los turnos
   * existentes en TODAS las orgs del doctor.
   */
  async getAvailableSlots(
    organizationId: string,
    doctorId: string,
    date: string,
  ): Promise<AvailableSlot[]> {
    
    const orgDoctorId = await this.orgService.getOrgDoctorId(organizationId, doctorId);

    // 1. Obtener día de la semana
    const dayOfWeek = new Date(date).getDay();

    // 2. Obtener horario del doctor para este día EN ESTA ORG
    const schedule = await this.db.queryOne(
      `SELECT start_time::text, end_time::text, slot_duration_minutes
       FROM doctor_schedules
       WHERE org_doctor_id = $1 AND day_of_week = $2 AND is_active = true`,
      [orgDoctorId, dayOfWeek],
    );

    if (!schedule) {
      return []; // El doctor no atiende este día en esta org
    }

    // 3. Verificar excepciones
    const exception = await this.db.queryOne(
      `SELECT is_available, start_time::text, end_time::text
       FROM schedule_exceptions
       WHERE org_doctor_id = $1 AND date = $2::date`,
      [orgDoctorId, date],
    );

    if (exception && !exception.is_available) {
      return []; // Día bloqueado (feriado, ausencia)
    }

    const startTime = exception?.start_time || schedule.start_time;
    const endTime = exception?.end_time || schedule.end_time;
    const slotMinutes = schedule.slot_duration_minutes;

    // 4. Generar slots
    const slots: AvailableSlot[] = [];
    let current = this.timeToMinutes(startTime);
    const end = this.timeToMinutes(endTime);

    while (current + slotMinutes <= end) {
      const slotStart = this.minutesToTime(current);
      const slotEnd = this.minutesToTime(current + slotMinutes);
      slots.push({ startTime: slotStart, endTime: slotEnd, isAvailable: true });
      current += slotMinutes;
    }

    // 5. Obtener TODOS los turnos del doctor en TODAS las orgs para esa fecha
    const existingAppointments = await this.db.queryMany(
      `SELECT 
        a.start_time::text AS start_time,
        a.end_time::text AS end_time,
        o.name AS org_name
       FROM appointments a
       JOIN organization_doctors od ON od.id = a.org_doctor_id
       JOIN organizations o ON o.id = a.organization_id
       WHERE od.doctor_id = $1
         AND a.date = $2::date
         AND a.status NOT IN ('cancelled', 'no_show')
       ORDER BY a.start_time`,
      [doctorId, date],
    );

    // 6. Marcar slots ocupados
    for (const slot of slots) {
      for (const appt of existingAppointments) {
        const slotStartMin = this.timeToMinutes(slot.startTime);
        const slotEndMin = this.timeToMinutes(slot.endTime);
        const apptStartMin = this.timeToMinutes(appt.start_time);
        const apptEndMin = this.timeToMinutes(appt.end_time);

        // Superposición
        if (slotStartMin < apptEndMin && slotEndMin > apptStartMin) {
          slot.isAvailable = false;
          slot.conflictOrg = appt.org_name;
          break;
        }
      }
    }

    return slots;
  }

  // ═══════════════════════════════════════════════════════════
  // AGENDA DEL DÍA
  // ═══════════════════════════════════════════════════════════

  /**
   * Agenda de un doctor en una organización para una fecha.
   * Incluye indicador de si tiene turnos en OTRAS orgs ese día.
   */
  async getDailyAgenda(organizationId: string, doctorId: string, date: string) {
    const orgDoctorId = await this.orgService.getOrgDoctorId(organizationId, doctorId);

    // Turnos de esta org
    const appointments = await this.db.queryMany(
      `SELECT 
        a.*,
        p.first_name || ' ' || p.last_name AS patient_name,
        p.phone AS patient_phone,
        p.insurance_provider,
        p.insurance_plan
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       WHERE a.org_doctor_id = $1 AND a.date = $2::date AND a.status != 'cancelled'
       ORDER BY a.start_time`,
      [orgDoctorId, date],
    );

    // Turnos en OTRAS orgs (solo resumen, por privacidad)
    const otherOrgAppointments = await this.db.queryMany(
      `SELECT 
        a.start_time::text,
        a.end_time::text,
        o.name AS org_name,
        a.status
       FROM appointments a
       JOIN organization_doctors od ON od.id = a.org_doctor_id
       JOIN organizations o ON o.id = a.organization_id
       WHERE od.doctor_id = $1
         AND a.date = $2::date
         AND a.organization_id != $3
         AND a.status NOT IN ('cancelled', 'no_show')
       ORDER BY a.start_time`,
      [doctorId, date, organizationId],
    );

    return {
      date,
      organizationId,
      appointments,
      otherOrgBlocks: otherOrgAppointments.map(a => ({
        startTime: a.start_time.substring(0, 5),
        endTime: a.end_time.substring(0, 5),
        orgName: a.org_name,
        status: a.status,
        // NO muestra datos del paciente de otra org (privacidad)
      })),
      totalThisOrg: appointments.length,
      totalOtherOrgs: otherOrgAppointments.length,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // VISTA UNIFICADA (todas las orgs del doctor)
  // ═══════════════════════════════════════════════════════════

  /**
   * Vista panorámica del día del doctor en TODOS sus consultorios.
   * Para la pantalla de "mi día completo" en la app.
   */
  async getDoctorFullDay(doctorId: string, date: string) {
    const allAppointments = await this.db.queryMany(
      `SELECT 
        a.id,
        a.organization_id,
        o.name AS org_name,
        o.type AS org_type,
        a.date::text,
        a.start_time::text,
        a.end_time::text,
        a.status,
        a.reason,
        a.is_online,
        a.room_number,
        p.first_name || ' ' || p.last_name AS patient_name,
        p.phone AS patient_phone,
        a.is_first_visit
       FROM appointments a
       JOIN organization_doctors od ON od.id = a.org_doctor_id
       JOIN organizations o ON o.id = a.organization_id
       JOIN patients p ON p.id = a.patient_id
       WHERE od.doctor_id = $1
         AND a.date = $2::date
         AND a.status NOT IN ('cancelled')
       ORDER BY a.start_time`,
      [doctorId, date],
    );

    // Agrupar por organización
    const byOrg: Record<string, any> = {};
    for (const appt of allAppointments) {
      if (!byOrg[appt.organization_id]) {
        byOrg[appt.organization_id] = {
          orgId: appt.organization_id,
          orgName: appt.org_name,
          orgType: appt.org_type,
          appointments: [],
        };
      }
      byOrg[appt.organization_id].appointments.push(appt);
    }

    // Detectar superposiciones
    const overlaps: any[] = [];
    for (let i = 0; i < allAppointments.length; i++) {
      for (let j = i + 1; j < allAppointments.length; j++) {
        const a = allAppointments[i];
        const b = allAppointments[j];
        if (a.start_time < b.end_time && a.end_time > b.start_time) {
          overlaps.push({
            appointment1: { id: a.id, time: `${a.start_time.substring(0,5)}-${a.end_time.substring(0,5)}`, org: a.org_name, patient: a.patient_name },
            appointment2: { id: b.id, time: `${b.start_time.substring(0,5)}-${b.end_time.substring(0,5)}`, org: b.org_name, patient: b.patient_name },
          });
        }
      }
    }

    return {
      date,
      totalAppointments: allAppointments.length,
      organizations: Object.values(byOrg),
      timeline: allAppointments,       // Línea de tiempo unificada
      overlaps,                        // Alertas de superposición
      hasOverlaps: overlaps.length > 0,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // OPERACIONES ESTÁNDAR
  // ═══════════════════════════════════════════════════════════

  async updateStatus(appointmentId: string, organizationId: string, status: string, cancelReason?: string) {
    const validTransitions: Record<string, string[]> = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['in_progress', 'cancelled', 'no_show'],
      in_progress: ['completed', 'cancelled'],
    };

    const current = await this.db.queryOne(
      'SELECT status FROM appointments WHERE id = $1 AND organization_id = $2',
      [appointmentId, organizationId],
    );

    if (!current) throw new NotFoundException('Turno no encontrado');

    if (!validTransitions[current.status]?.includes(status)) {
      throw new BadRequestException(
        `No se puede cambiar de "${current.status}" a "${status}"`,
      );
    }

    const extraFields = status === 'cancelled'
      ? ', cancelled_at = NOW(), cancelled_reason = $4'
      : '';

    const params = status === 'cancelled'
      ? [status, appointmentId, organizationId, cancelReason || null]
      : [status, appointmentId, organizationId];

    return this.db.queryOne(
      `UPDATE appointments SET status = $1 ${extraFields}
       WHERE id = $2 AND organization_id = $3
       RETURNING *`,
      params,
    );
  }

  async getByDateRange(organizationId: string, doctorId: string, from: string, to: string) {
    const orgDoctorId = await this.orgService.getOrgDoctorId(organizationId, doctorId);

    return this.db.queryMany(
      `SELECT a.*, p.first_name || ' ' || p.last_name AS patient_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       WHERE a.org_doctor_id = $1 AND a.date BETWEEN $2::date AND $3::date
       ORDER BY a.date, a.start_time`,
      [orgDoctorId, from, to],
    );
  }

  // ─── Helpers ────────────────────────────────────────────

  private timeToMinutes(time: string): number {
    const parts = time.substring(0, 5).split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  }

  private minutesToTime(minutes: number): string {
    const h = Math.floor(minutes / 60).toString().padStart(2, '0');
    const m = (minutes % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  private async getOrgName(orgId: string): Promise<string> {
    const org = await this.db.queryOne('SELECT name FROM organizations WHERE id = $1', [orgId]);
    return org?.name || 'Desconocido';
  }

  private async createNotification(
    recipientId: string,
    type: string,
    title: string,
    body: string,
    data: any,
  ) {
    try {
      await this.db.query(
        `INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
         VALUES ('patient', $1, $2, $3, $4, $5)`,
        [recipientId, type, title, body, JSON.stringify(data)],
      );
    } catch (err) {
      this.logger.warn(`Failed to create notification: ${err.message}`);
    }
  }
}
