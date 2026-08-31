import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AppointmentService } from '../appointments/appointment.service';
import { PushService } from '../push/push.service';

// ─── DTOs ───────────────────────────────────────────────────

export interface BookingSettingsDto {
  isEnabled?: boolean;
  publicSlug?: string;
  bookingMode?: 'open' | 'approval' | 'deposit' | 'deposit_approval';
  requiresDeposit?: boolean;
  depositAmount?: number;
  depositPercentage?: number;
  consultationFee?: number;
  paymentMethods?: 'transfer' | 'cash' | 'both';
  bankName?: string;
  bankAccountHolder?: string;
  bankCbu?: string;
  bankAlias?: string;
  paymentDeadlineMinutes?: number;
  chargeOnNoShow?: boolean;
  noShowFee?: number;
  keepsDepositOnNoShow?: boolean;
  minHoursBeforeCancel?: number;
  refundOnEarlyCancel?: boolean;
  maxDaysInAdvance?: number;
  minHoursInAdvance?: number;
  allowNewPatients?: boolean;
  requiresInsuranceInfo?: boolean;
  allowsPrepaidPrescription?: boolean;
  prescriptionRequiresPayment?: boolean;
  welcomeMessage?: string;
  instructions?: string;
  cancellationPolicyText?: string;
}

export interface CreateBookingDto {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  dni?: string;
  dateOfBirth?: string;
  insuranceProvider?: string;
  insuranceNumber?: string;
  requestedDate: string;
  requestedStartTime: string;
  requestedEndTime: string;
  reason?: string;
  paymentMethod?: 'transfer' | 'cash';
  source?: string;
}

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    private db: DatabaseService,
    private apptService: AppointmentService,
    private pushService: PushService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // CONFIGURACIÓN (lado médico)
  // ═══════════════════════════════════════════════════════════

  async getSettings(orgId: string, doctorId: string) {
    const orgDoctorId = await this.getOrgDoctorId(orgId, doctorId);

    let settings = await this.db.queryOne(
      `SELECT * FROM booking_settings WHERE org_doctor_id = $1`,
      [orgDoctorId],
    );

    // Si no existe, crear con defaults
    if (!settings) {
      const doctor = await this.db.queryOne(
        `SELECT first_name, last_name FROM doctors WHERE id = $1`,
        [doctorId],
      );
      const baseSlug = this.slugify(`${doctor.first_name}-${doctor.last_name}`);
      const slug = await this.uniqueSlug(baseSlug);

      settings = await this.db.queryOne(
        `INSERT INTO booking_settings (org_doctor_id, public_slug)
         VALUES ($1, $2) RETURNING *`,
        [orgDoctorId, slug],
      );
    }

    return settings;
  }

  async updateSettings(orgId: string, doctorId: string, dto: BookingSettingsDto) {
    const orgDoctorId = await this.getOrgDoctorId(orgId, doctorId);
    await this.getSettings(orgId, doctorId); // asegura que exista

    // Validar slug único
    if (dto.publicSlug) {
      const existing = await this.db.queryOne(
        `SELECT id FROM booking_settings WHERE public_slug = $1 AND org_doctor_id != $2`,
        [dto.publicSlug, orgDoctorId],
      );
      if (existing) throw new ConflictException('Ese enlace ya está en uso');
    }

    const mapping: Record<string, string> = {
      isEnabled: 'is_enabled',
      publicSlug: 'public_slug',
      bookingMode: 'booking_mode',
      requiresDeposit: 'requires_deposit',
      depositAmount: 'deposit_amount',
      depositPercentage: 'deposit_percentage',
      consultationFee: 'consultation_fee',
      paymentMethods: 'payment_methods',
      bankName: 'bank_name',
      bankAccountHolder: 'bank_account_holder',
      bankCbu: 'bank_cbu',
      bankAlias: 'bank_alias',
      paymentDeadlineMinutes: 'payment_deadline_minutes',
      chargeOnNoShow: 'charge_on_no_show',
      noShowFee: 'no_show_fee',
      keepsDepositOnNoShow: 'keeps_deposit_on_no_show',
      minHoursBeforeCancel: 'min_hours_before_cancel',
      refundOnEarlyCancel: 'refund_on_early_cancel',
      maxDaysInAdvance: 'max_days_in_advance',
      minHoursInAdvance: 'min_hours_in_advance',
      allowNewPatients: 'allow_new_patients',
      requiresInsuranceInfo: 'requires_insurance_info',
      allowsPrepaidPrescription: 'allows_prepaid_prescription',
      prescriptionRequiresPayment: 'prescription_requires_payment',
      welcomeMessage: 'welcome_message',
      instructions: 'instructions',
      cancellationPolicyText: 'cancellation_policy_text',
    };

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, col] of Object.entries(mapping)) {
      if (dto[key] !== undefined) {
        fields.push(`${col} = $${idx}`);
        values.push(dto[key]);
        idx++;
      }
    }

    if (fields.length === 0) return this.getSettings(orgId, doctorId);

    values.push(orgDoctorId);
    return this.db.queryOne(
      `UPDATE booking_settings SET ${fields.join(', ')} WHERE org_doctor_id = $${idx} RETURNING *`,
      values,
    );
  }

  // ═══════════════════════════════════════════════════════════
  // PÚBLICO (lado paciente — sin auth)
  // ═══════════════════════════════════════════════════════════

  /** Perfil público del médico por slug */
  async getPublicProfile(slug: string) {
    const profile = await this.db.queryOne(
      `SELECT * FROM v_public_doctor_profile WHERE public_slug = $1`,
      [slug],
    );
    if (!profile) throw new NotFoundException('Página de reservas no encontrada');
    return profile;
  }

  /** Slots disponibles para el público */
  async getPublicSlots(slug: string, date: string) {
    const profile = await this.getPublicProfile(slug);

    // Validar rango de fechas permitido
    const requested = new Date(date + 'T00:00:00');
    const now = new Date();
    const daysAhead = Math.floor((requested.getTime() - now.getTime()) / 86400000);

    if (daysAhead > profile.max_days_in_advance) {
      throw new BadRequestException(
        `Solo se puede reservar con ${profile.max_days_in_advance} días de anticipación`,
      );
    }

    // Obtener slots del doctor
    const slots = await this.apptService.getAvailableSlots(
      profile.organization_id,
      profile.doctor_id,
      date,
    );

    // Filtrar por anticipación mínima
    const minTime = new Date(now.getTime() + profile.min_hours_in_advance * 3600000);

    // Excluir slots con hold activo
    const holds = await this.db.queryMany(
      `SELECT start_time::text FROM slot_holds
       WHERE org_doctor_id = $1 AND date = $2::date AND expires_at > NOW()`,
      [profile.org_doctor_id, date],
    );
    const heldTimes = new Set(holds.map(h => h.start_time.substring(0, 5)));

    return slots
      .filter(s => {
        const slotDateTime = new Date(`${date}T${s.startTime}:00`);
        return slotDateTime >= minTime && !heldTimes.has(s.startTime);
      })
      .map(s => ({
        startTime: s.startTime,
        endTime: s.endTime,
        isAvailable: s.isAvailable,
      }));
  }

  /** Crear solicitud de reserva */
  async createBooking(slug: string, dto: CreateBookingDto) {
    const profile = await this.getPublicProfile(slug);

    // Validaciones
    if (!profile.allow_new_patients) {
      const existing = await this.db.queryOne(
        `SELECT id FROM patients WHERE organization_id = $1 AND (phone = $2 OR dni = $3)`,
        [profile.organization_id, dto.phone, dto.dni],
      );
      if (!existing) {
        throw new BadRequestException('Este médico solo atiende pacientes existentes');
      }
    }

    if (profile.requires_insurance_info && !dto.insuranceProvider) {
      throw new BadRequestException('Se requieren datos de obra social');
    }

    // Verificar disponibilidad real
    const conflict = await this.apptService.checkConflicts(
      profile.doctor_id,
      dto.requestedDate,
      dto.requestedStartTime,
      dto.requestedEndTime,
    );
    if (conflict.hasConflict) {
      throw new ConflictException('Ese horario ya no está disponible');
    }

    // Determinar estado inicial según modalidad
    const mode = profile.booking_mode;
    let status: string;
    let depositRequired: number | null = null;
    let paymentDeadline: Date | null = null;

    if (mode === 'open') {
      status = 'confirmed';
    } else if (mode === 'approval') {
      status = 'pending_approval';
    } else {
      // deposit o deposit_approval
      status = 'pending_payment';
      depositRequired = profile.deposit_amount
        ?? (profile.consultation_fee && profile.deposit_percentage
            ? (profile.consultation_fee * profile.deposit_percentage / 100)
            : null);
      paymentDeadline = new Date(Date.now() + profile.payment_deadline_minutes * 60000);
    }

    // Buscar paciente existente
    const existingPatient = await this.db.queryOne(
      `SELECT id FROM patients WHERE organization_id = $1 AND (phone = $2 OR (dni IS NOT NULL AND dni = $3))`,
      [profile.organization_id, dto.phone, dto.dni],
    );

    return this.db.transaction(async (client) => {
      // Crear solicitud
      const booking = await client.query(
        `INSERT INTO booking_requests (
          org_doctor_id, organization_id, patient_id,
          first_name, last_name, dni, email, phone, date_of_birth,
          insurance_provider, insurance_number,
          requested_date, requested_start_time, requested_end_time, reason,
          is_first_visit, status, deposit_required, payment_method, payment_deadline, source
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::time,$14::time,$15,$16,$17,$18,$19,$20,$21)
        RETURNING *`,
        [
          profile.org_doctor_id, profile.organization_id, existingPatient?.id || null,
          dto.firstName, dto.lastName, dto.dni, dto.email, dto.phone, dto.dateOfBirth,
          dto.insuranceProvider, dto.insuranceNumber,
          dto.requestedDate, dto.requestedStartTime, dto.requestedEndTime, dto.reason,
          !existingPatient, status, depositRequired, dto.paymentMethod,
          paymentDeadline?.toISOString() || null, dto.source || 'public_link',
        ],
      );

      const bookingRow = booking.rows[0];

      // Bloquear el slot temporalmente
      const holdExpiry = paymentDeadline || new Date(Date.now() + 30 * 60000);
      await client.query(
        `INSERT INTO slot_holds (org_doctor_id, date, start_time, end_time, booking_request_id, expires_at)
         VALUES ($1, $2::date, $3::time, $4::time, $5, $6)`,
        [profile.org_doctor_id, dto.requestedDate, dto.requestedStartTime,
         dto.requestedEndTime, bookingRow.id, holdExpiry.toISOString()],
      );

      // Si es 'open', crear el turno directamente
      if (status === 'confirmed') {
        const appt = await this.createAppointmentFromBooking(client, bookingRow, profile);
        await client.query(
          `UPDATE booking_requests SET appointment_id = $1 WHERE id = $2`,
          [appt.id, bookingRow.id],
        );
        bookingRow.appointment_id = appt.id;
      }

      // Notificar al médico (push real + DB)
      // Esto se ejecuta fuera de la transacción para no bloquear
      const pushTitle = status === 'confirmed' ? 'Nuevo turno reservado' : 'Nueva solicitud de turno';
      const pushBody = `${dto.firstName} ${dto.lastName} — ${dto.requestedDate} ${dto.requestedStartTime}`;
      this.pushService.notify(
        'doctor',
        profile.doctor_id,
        {
          title: pushTitle,
          body: pushBody,
          data: { bookingRequestId: bookingRow.id, status, type: 'new_booking' },
          sound: 'default',
          category: status === 'confirmed' ? 'NEW_APPOINTMENT' : 'BOOKING_REQUEST',
        },
        profile.organization_id,
        'appointment_reminder',
      ).catch(err => this.logger.warn(`Push notification failed: ${err.message}`));

      this.logger.log(`Booking created: ${bookingRow.id} (${status}) for ${slug}`);

      return {
        booking: bookingRow,
        confirmationToken: bookingRow.confirmation_token,
        status,
        depositRequired,
        paymentDeadline,
        paymentInfo: depositRequired ? {
          amount: depositRequired,
          methods: profile.payment_methods,
          bankName: profile.bank_name,
          accountHolder: profile.bank_account_holder,
          cbu: profile.bank_cbu,
          alias: profile.bank_alias,
          deadlineMinutes: profile.payment_deadline_minutes,
        } : null,
      };
    });
  }

  /** Consultar estado de una reserva por token */
  async getBookingByToken(token: string) {
    const booking = await this.db.queryOne(
      `SELECT br.*, 
              d.first_name || ' ' || d.last_name AS doctor_name,
              d.specialty, o.name AS org_name, o.address, o.phone AS org_phone,
              bs.bank_name, bs.bank_account_holder, bs.bank_cbu, bs.bank_alias,
              bs.payment_methods, bs.cancellation_policy_text, bs.instructions
       FROM booking_requests br
       JOIN organization_doctors od ON od.id = br.org_doctor_id
       JOIN doctors d ON d.id = od.doctor_id
       JOIN organizations o ON o.id = br.organization_id
       LEFT JOIN booking_settings bs ON bs.org_doctor_id = br.org_doctor_id
       WHERE br.confirmation_token = $1`,
      [token],
    );
    if (!booking) throw new NotFoundException('Reserva no encontrada');
    return booking;
  }

  /** Subir comprobante de pago */
  async uploadPaymentProof(token: string, proofUrl: string, reference?: string) {
    const booking = await this.getBookingByToken(token);

    if (booking.status !== 'pending_payment') {
      throw new BadRequestException('Esta reserva no requiere pago');
    }

    return this.db.transaction(async (client) => {
      await client.query(
        `UPDATE booking_requests
         SET payment_status = 'proof_uploaded', payment_proof_url = $1, payment_reference = $2
         WHERE confirmation_token = $3`,
        [proofUrl, reference, token],
      );

      await client.query(
        `INSERT INTO payments (organization_id, booking_request_id, amount, method, status, proof_url, reference)
         VALUES ($1, $2, $3, $4, 'proof_uploaded', $5, $6)`,
        [booking.organization_id, booking.id, booking.deposit_required,
         booking.payment_method || 'transfer', proofUrl, reference],
      );

      // Notificar al médico (push real)
      const orgDoctor = await client.query(
        `SELECT doctor_id FROM organization_doctors WHERE id = $1`,
        [booking.org_doctor_id],
      );

      this.pushService.notify(
        'doctor',
        orgDoctor.rows[0].doctor_id,
        {
          title: 'Comprobante de pago recibido',
          body: `${booking.first_name} ${booking.last_name} subió el comprobante`,
          data: { bookingRequestId: booking.id, type: 'booking_payment' },
          sound: 'default',
          category: 'PAYMENT_RECEIVED',
        },
        booking.organization_id,
        'appointment_reminder',
      ).catch(err => this.logger.warn(`Push notification failed: ${err.message}`));

      return { message: 'Comprobante recibido. El médico lo va a verificar.' };
    });
  }

  /** Cancelar reserva (paciente) */
  async cancelBooking(token: string, reason?: string) {
    const booking = await this.getBookingByToken(token);

    const apptDateTime = new Date(`${booking.requested_date}T${booking.requested_start_time}`);
    const hoursUntil = (apptDateTime.getTime() - Date.now()) / 3600000;

    const settings = await this.db.queryOne(
      `SELECT min_hours_before_cancel, refund_on_early_cancel FROM booking_settings WHERE org_doctor_id = $1`,
      [booking.org_doctor_id],
    );

    const canRefund = hoursUntil >= (settings?.min_hours_before_cancel || 24)
                      && settings?.refund_on_early_cancel;

    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE booking_requests SET status = 'cancelled' WHERE confirmation_token = $1`,
        [token],
      );

      if (booking.appointment_id) {
        await client.query(
          `UPDATE appointments SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = 'patient', cancelled_reason = $1
           WHERE id = $2`,
          [reason || 'Cancelado por el paciente', booking.appointment_id],
        );
      }

      await client.query(`DELETE FROM slot_holds WHERE booking_request_id = $1`, [booking.id]);

      if (canRefund && booking.payment_status === 'confirmed') {
        await client.query(
          `UPDATE payments SET status = 'refunded' WHERE booking_request_id = $1`,
          [booking.id],
        );
      }
    });

    return {
      message: 'Reserva cancelada',
      refundEligible: canRefund,
      hoursBeforeAppointment: Math.round(hoursUntil),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // GESTIÓN (lado médico)
  // ═══════════════════════════════════════════════════════════

  /** Solicitudes pendientes */
  async getPendingRequests(orgId: string, doctorId: string) {
    const orgDoctorId = await this.getOrgDoctorId(orgId, doctorId);

    return this.db.queryMany(
      `SELECT br.*, p.id AS existing_patient_id
       FROM booking_requests br
       LEFT JOIN patients p ON p.id = br.patient_id
       WHERE br.org_doctor_id = $1
         AND br.status IN ('pending_payment', 'pending_approval')
       ORDER BY br.created_at DESC`,
      [orgDoctorId],
    );
  }

  /** Aprobar solicitud */
  async approveRequest(orgId: string, doctorId: string, requestId: string) {
    const booking = await this.db.queryOne(
      `SELECT * FROM booking_requests WHERE id = $1 AND organization_id = $2`,
      [requestId, orgId],
    );
    if (!booking) throw new NotFoundException('Solicitud no encontrada');

    const profile = await this.db.queryOne(
      `SELECT od.id AS org_doctor_id, od.doctor_id, od.organization_id
       FROM organization_doctors od WHERE od.id = $1`,
      [booking.org_doctor_id],
    );

    return this.db.transaction(async (client) => {
      // Crear paciente si no existe
      let patientId = booking.patient_id;
      if (!patientId) {
        const newPatient = await client.query(
          `INSERT INTO patients (organization_id, first_name, last_name, dni, email, phone,
                                 date_of_birth, insurance_provider, insurance_number)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [orgId, booking.first_name, booking.last_name, booking.dni, booking.email,
           booking.phone, booking.date_of_birth, booking.insurance_provider, booking.insurance_number],
        );
        patientId = newPatient.rows[0].id;
      }

      // Crear turno
      const appt = await client.query(
        `INSERT INTO appointments (organization_id, org_doctor_id, patient_id, date,
                                   start_time, end_time, status, reason, is_first_visit,
                                   created_by_type, created_by_id)
         VALUES ($1,$2,$3,$4::date,$5::time,$6::time,'confirmed',$7,$8,'patient',$3)
         RETURNING *`,
        [orgId, booking.org_doctor_id, patientId, booking.requested_date,
         booking.requested_start_time, booking.requested_end_time,
         booking.reason, booking.is_first_visit],
      );

      await client.query(
        `UPDATE booking_requests
         SET status = 'confirmed', patient_id = $1, appointment_id = $2,
             reviewed_at = NOW(), reviewed_by = $3
         WHERE id = $4`,
        [patientId, appt.rows[0].id, doctorId, requestId],
      );

      await client.query(`DELETE FROM slot_holds WHERE booking_request_id = $1`, [requestId]);

      this.logger.log(`Booking approved: ${requestId} → appointment ${appt.rows[0].id}`);

      return { appointment: appt.rows[0], patientId };
    });
  }

  /** Rechazar solicitud */
  async rejectRequest(orgId: string, doctorId: string, requestId: string, reason?: string) {
    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE booking_requests
         SET status = 'rejected', rejection_reason = $1, reviewed_at = NOW(), reviewed_by = $2
         WHERE id = $3 AND organization_id = $4`,
        [reason, doctorId, requestId, orgId],
      );
      await client.query(`DELETE FROM slot_holds WHERE booking_request_id = $1`, [requestId]);
    });
    return { message: 'Solicitud rechazada' };
  }

  /** Confirmar pago recibido */
  async confirmPayment(orgId: string, doctorId: string, requestId: string) {
    const booking = await this.db.queryOne(
      `SELECT * FROM booking_requests WHERE id = $1 AND organization_id = $2`,
      [requestId, orgId],
    );
    if (!booking) throw new NotFoundException('Solicitud no encontrada');

    await this.db.query(
      `UPDATE booking_requests
       SET payment_status = 'confirmed', payment_confirmed_at = NOW()
       WHERE id = $1`,
      [requestId],
    );

    await this.db.query(
      `UPDATE payments SET status = 'confirmed', confirmed_by = $1, confirmed_at = NOW()
       WHERE booking_request_id = $2`,
      [doctorId, requestId],
    );

    // Si la modalidad es solo depósito (sin aprobación), aprobar automáticamente
    const settings = await this.db.queryOne(
      `SELECT booking_mode FROM booking_settings WHERE org_doctor_id = $1`,
      [booking.org_doctor_id],
    );

    if (settings?.booking_mode === 'deposit') {
      return this.approveRequest(orgId, doctorId, requestId);
    }

    await this.db.query(
      `UPDATE booking_requests SET status = 'pending_approval' WHERE id = $1`,
      [requestId],
    );

    return { message: 'Pago confirmado. Pendiente de aprobación.' };
  }

  /** Registrar no-show y cobrar si corresponde */
  async registerNoShow(orgId: string, doctorId: string, appointmentId: string) {
    const appt = await this.db.queryOne(
      `SELECT a.*, od.id AS org_doctor_id FROM appointments a
       JOIN organization_doctors od ON od.id = a.org_doctor_id
       WHERE a.id = $1 AND a.organization_id = $2`,
      [appointmentId, orgId],
    );
    if (!appt) throw new NotFoundException('Turno no encontrado');

    const settings = await this.db.queryOne(
      `SELECT charge_on_no_show, no_show_fee, keeps_deposit_on_no_show
       FROM booking_settings WHERE org_doctor_id = $1`,
      [appt.org_doctor_id],
    );

    await this.db.query(
      `UPDATE appointments SET status = 'no_show' WHERE id = $1`,
      [appointmentId],
    );

    let charged = null;

    if (settings?.charge_on_no_show && settings.no_show_fee) {
      const payment = await this.db.queryOne(
        `INSERT INTO payments (organization_id, appointment_id, patient_id, amount, method, status, payment_type, notes)
         VALUES ($1, $2, $3, $4, 'cash', 'pending', 'no_show_fee', 'Cargo por inasistencia')
         RETURNING *`,
        [orgId, appointmentId, appt.patient_id, settings.no_show_fee],
      );
      charged = payment;
    }

    return {
      message: 'Inasistencia registrada',
      keepsDeposit: settings?.keeps_deposit_on_no_show ?? false,
      noShowCharge: charged,
    };
  }

  // ─── Helpers ────────────────────────────────────────────

  private async getOrgDoctorId(orgId: string, doctorId: string): Promise<string> {
    const r = await this.db.queryOne(
      `SELECT id FROM organization_doctors WHERE organization_id = $1 AND doctor_id = $2 AND is_active = true`,
      [orgId, doctorId],
    );
    if (!r) throw new NotFoundException('Doctor no pertenece a esta organización');
    return r.id;
  }

  private slugify(text: string): string {
    return text.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private async uniqueSlug(base: string): Promise<string> {
    let slug = base;
    let n = 1;
    while (await this.db.queryOne(`SELECT id FROM booking_settings WHERE public_slug = $1`, [slug])) {
      slug = `${base}-${n}`;
      n++;
    }
    return slug;
  }

  private async createAppointmentFromBooking(client: any, booking: any, profile: any) {
    let patientId = booking.patient_id;

    if (!patientId) {
      const newPatient = await client.query(
        `INSERT INTO patients (organization_id, first_name, last_name, dni, email, phone,
                               date_of_birth, insurance_provider, insurance_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [profile.organization_id, booking.first_name, booking.last_name, booking.dni,
         booking.email, booking.phone, booking.date_of_birth,
         booking.insurance_provider, booking.insurance_number],
      );
      patientId = newPatient.rows[0].id;
      await client.query(`UPDATE booking_requests SET patient_id = $1 WHERE id = $2`, [patientId, booking.id]);
    }

    const appt = await client.query(
      `INSERT INTO appointments (organization_id, org_doctor_id, patient_id, date,
                                 start_time, end_time, status, reason, is_first_visit,
                                 created_by_type, created_by_id)
       VALUES ($1,$2,$3,$4::date,$5::time,$6::time,'confirmed',$7,$8,'patient',$3)
       RETURNING *`,
      [profile.organization_id, profile.org_doctor_id, patientId, booking.requested_date,
       booking.requested_start_time, booking.requested_end_time,
       booking.reason, booking.is_first_visit],
    );

    return appt.rows[0];
  }
}
