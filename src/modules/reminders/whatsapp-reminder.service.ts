import { Injectable, Logger, OnModuleDestroy, OnModuleInit, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';

/**
 * Recordatorio por WhatsApp un día antes del turno.
 *
 * Solo se envía a pacientes que lo pidieron al reservar (botón "Agregar recordatorio por WhatsApp").
 * Usa la API de WhatsApp Cloud de Meta con una plantilla aprobada (fuera de la ventana de 24 h
 * Meta solo permite plantillas). Se activa con:
 *   WHATSAPP_TOKEN            token permanente del usuario de sistema
 *   WHATSAPP_PHONE_NUMBER_ID  ID del número emisor
 *   WHATSAPP_TEMPLATE         nombre de la plantilla (por defecto: recordatorio_turno)
 *   WHATSAPP_TEMPLATE_LANG    idioma de la plantilla (por defecto: es_AR)
 * Sin esas variables el pedido queda guardado y no se envía nada.
 *
 * Plantilla sugerida (categoría "Utilidad"), 4 variables en el cuerpo:
 *   Hola {{1}}, te recordamos tu turno de mañana con Dr/a. {{2}} a las {{3}} hs en {{4}}.
 *   Si no podés asistir, avisá al consultorio.
 */
@Injectable()
export class WhatsappReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappReminderService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private db: DatabaseService, private config: ConfigService) {}

  onModuleInit() {
    // Revisa cada 10 minutos; el envío es idempotente (se marca antes de enviar)
    this.timer = setInterval(() => this.procesar().catch(e => this.logger.error(e.message)), 10 * 60_000);
    setTimeout(() => this.procesar().catch(e => this.logger.error(e.message)), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  get habilitado(): boolean {
    return !!(this.config.get('WHATSAPP_TOKEN') && this.config.get('WHATSAPP_PHONE_NUMBER_ID'));
  }

  /** Normaliza un celular argentino al formato que usa WhatsApp: 549 + característica + número */
  static normalizarCelular(raw: string): string | null {
    let d = String(raw || '').replace(/\D/g, '');
    if (!d) return null;
    if (d.startsWith('00')) d = d.slice(2);
    if (!d.startsWith('54')) {
      d = d.replace(/^0/, '');
      d = '54' + d;
    }
    let resto = d.slice(2).replace(/^0/, '');
    if (!resto.startsWith('9')) resto = '9' + resto;
    // Quitar el "15" que algunos escriben después de la característica (ej: 3447 15 412345)
    const sin9 = resto.slice(1);
    const m = sin9.match(/^(\d{2,4})15(\d{6,8})$/);
    if (m && (m[1] + m[2]).length === 10) resto = '9' + m[1] + m[2];
    if (resto.length !== 11) return null; // 9 + 10 dígitos
    return '54' + resto;
  }

  /** El paciente pide el recordatorio desde la pantalla de confirmación (con el token de su reserva) */
  async solicitar(token: string, phone: string) {
    const numero = WhatsappReminderService.normalizarCelular(phone);
    if (!numero) throw new BadRequestException('Revisá el número: código de área y número, sin 0 ni 15');

    const br = await this.db.queryOne(
      `SELECT br.id, br.appointment_id, br.patient_id, br.phone, a.patient_id AS appt_patient
         FROM booking_requests br LEFT JOIN appointments a ON a.id = br.appointment_id
        WHERE br.confirmation_token = $1`,
      [token],
    );
    if (!br || !br.appointment_id) throw new NotFoundException('Reserva no encontrada');

    const appt = await this.db.queryOne(
      `UPDATE appointments
          SET whatsapp_reminder = true, whatsapp_reminder_phone = $2,
              whatsapp_reminder_requested_at = now(), whatsapp_reminder_sent_at = NULL, whatsapp_reminder_error = NULL
        WHERE id = $1 AND status NOT IN ('cancelled','completed','no_show')
        RETURNING id, date, start_time`,
      [br.appointment_id, '+' + numero],
    );
    if (!appt) throw new BadRequestException('Este turno ya no admite recordatorio');

    // Si corrigió el celular, se actualiza en la reserva y en su ficha para que el consultorio lo tenga bien
    const nuevo = '+' + numero;
    const anterior = String(br.phone || '');
    if (WhatsappReminderService.normalizarCelular(anterior) !== numero) {
      await this.db.query(`UPDATE booking_requests SET phone = $2 WHERE id = $1`, [br.id, nuevo]);
      const pid = br.appt_patient || br.patient_id;
      if (pid) await this.db.query(`UPDATE patients SET phone = $2 WHERE id = $1`, [pid, nuevo]);
    }

    return { ok: true, phone: nuevo, appointmentId: appt.id };
  }

  /** Envía los recordatorios cuyo turno empieza dentro de las próximas 24 h (hora de Argentina) */
  async procesar(): Promise<{ enviados: number; errores: number; pendientes?: number }> {
    if (this.running) return { enviados: 0, errores: 0 };
    this.running = true;
    try {
      if (!this.habilitado) return { enviados: 0, errores: 0 };
      const pendientes = await this.db.queryMany(
        `UPDATE appointments a SET whatsapp_reminder_sent_at = now(), whatsapp_reminder_channel = 'auto'
          WHERE a.id IN (
            SELECT id FROM appointments
             WHERE whatsapp_reminder AND whatsapp_reminder_sent_at IS NULL
               AND status IN ('confirmed','pending','pending_approval')
               AND EXISTS (SELECT 1 FROM organization_doctors od JOIN doctor_reminder_settings rs ON rs.doctor_id = od.doctor_id
                            WHERE od.id = appointments.org_doctor_id AND rs.whatsapp_reminder_mode = 'auto')
               AND (date + start_time) AT TIME ZONE 'America/Argentina/Buenos_Aires' > now()
               AND (date + start_time) AT TIME ZONE 'America/Argentina/Buenos_Aires' <= now() + interval '24 hours'
             LIMIT 50 FOR UPDATE SKIP LOCKED)
          RETURNING a.id`,
      );
      let enviados = 0, errores = 0;
      for (const { id } of pendientes) {
        const t = await this.db.queryOne(
          `SELECT a.whatsapp_reminder_phone AS phone, a.start_time,
                  p.first_name, d.first_name || ' ' || d.last_name AS doctor_name,
                  COALESCE(NULLIF(o.address,''), o.name) AS lugar
             FROM appointments a
             JOIN patients p ON p.id = a.patient_id
             JOIN organization_doctors od ON od.id = a.org_doctor_id
             JOIN doctors d ON d.id = od.doctor_id
             JOIN organizations o ON o.id = a.organization_id
            WHERE a.id = $1`,
          [id],
        );
        try {
          await this.enviarPlantilla(String(t.phone).replace(/\D/g, ''), [
            t.first_name || 'paciente', t.doctor_name, String(t.start_time).substring(0, 5), t.lugar || 'el consultorio',
          ]);
          enviados++;
        } catch (e: any) {
          errores++;
          await this.db.query(
            `UPDATE appointments SET whatsapp_reminder_error = $2 WHERE id = $1`,
            [id, String(e.message).slice(0, 500)],
          );
          this.logger.warn(`Recordatorio WhatsApp ${id}: ${e.message}`);
        }
      }
      if (pendientes.length) this.logger.log(`Recordatorios WhatsApp: ${enviados} enviados, ${errores} con error`);
      return { enviados, errores };
    } finally {
      this.running = false;
    }
  }

  // ─── Modo manual: el consultorio envía el recordatorio desde su WhatsApp con un botón ───

  async getModo(doctorId: string) {
    const r = await this.db.queryOne(
      `INSERT INTO doctor_reminder_settings (doctor_id) VALUES ($1)
       ON CONFLICT (doctor_id) DO UPDATE SET doctor_id = EXCLUDED.doctor_id
       RETURNING whatsapp_reminder_mode, whatsapp_reminder_all`,
      [doctorId],
    );
    return { modo: r.whatsapp_reminder_mode, todos: r.whatsapp_reminder_all, automaticoDisponible: this.habilitado };
  }

  async setModo(doctorId: string, modo?: string, todos?: boolean) {
    if (modo && !['manual', 'auto'].includes(modo)) throw new BadRequestException('Modo inválido');
    if (modo === 'auto' && !this.habilitado) throw new BadRequestException('El envío automático necesita WhatsApp Business conectado. Mientras tanto usá el modo manual.');
    await this.db.query(
      `INSERT INTO doctor_reminder_settings (doctor_id, whatsapp_reminder_mode, whatsapp_reminder_all) VALUES ($1, COALESCE($2,'manual'), COALESCE($3,true))
       ON CONFLICT (doctor_id) DO UPDATE SET whatsapp_reminder_mode = COALESCE($2, doctor_reminder_settings.whatsapp_reminder_mode),
         whatsapp_reminder_all = COALESCE($3, doctor_reminder_settings.whatsapp_reminder_all), updated_at = now()`,
      [doctorId, modo ?? null, typeof todos === 'boolean' ? todos : null],
    );
    return this.getModo(doctorId);
  }

  /** Turnos de una fecha (por defecto, mañana) para recordar por WhatsApp a mano */
  async pendientes(orgId: string, orgDoctorIds: string[], fecha?: string) {
    const dia = fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null;
    const rows = await this.db.queryMany(
      `SELECT a.id, to_char(a.date,'YYYY-MM-DD') AS date, a.start_time, a.end_time, a.status,
              a.whatsapp_reminder AS pidio, a.whatsapp_reminder_sent_at AS enviado_at, a.whatsapp_reminder_channel AS canal,
              COALESCE(a.whatsapp_reminder_phone, p.phone) AS phone,
              p.id AS patient_id, p.first_name, p.first_name || ' ' || p.last_name AS patient_name,
              d.first_name || ' ' || d.last_name AS doctor_name, o.name AS org_name, o.address AS org_address,
              COALESCE(rs.whatsapp_reminder_all, true) AS todos
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN organization_doctors od ON od.id = a.org_doctor_id
         JOIN doctors d ON d.id = od.doctor_id
         JOIN organizations o ON o.id = a.organization_id
         LEFT JOIN doctor_reminder_settings rs ON rs.doctor_id = d.id
        WHERE a.organization_id = $1 AND a.org_doctor_id = ANY($2::uuid[])
          AND a.date = COALESCE($3::date, (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + 1)
          AND a.status IN ('confirmed','pending','pending_approval')
        ORDER BY a.start_time`,
      [orgId, orgDoctorIds, dia],
    );
    return rows.filter((r: any) => r.pidio || r.todos);
  }

  async marcarEnviado(orgId: string, apptId: string, userId: string, enviado = true) {
    const r = await this.db.queryOne(
      `UPDATE appointments SET whatsapp_reminder_sent_at = CASE WHEN $3 THEN now() ELSE NULL END,
              whatsapp_reminder_channel = CASE WHEN $3 THEN 'manual' ELSE NULL END,
              whatsapp_reminder_sent_by = CASE WHEN $3 THEN $4::uuid ELSE NULL END
        WHERE id = $1 AND organization_id = $2 RETURNING id, whatsapp_reminder_sent_at`,
      [apptId, orgId, enviado, userId || null],
    );
    if (!r) throw new NotFoundException('Turno no encontrado');
    return r;
  }

  private async enviarPlantilla(to: string, vars: string[]) {
    const url = `https://graph.facebook.com/v21.0/${this.config.get('WHATSAPP_PHONE_NUMBER_ID')}/messages`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.get('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: this.config.get('WHATSAPP_TEMPLATE') || 'recordatorio_turno',
          language: { code: this.config.get('WHATSAPP_TEMPLATE_LANG') || 'es_AR' },
          components: [{ type: 'body', parameters: vars.map(text => ({ type: 'text', text: String(text).slice(0, 200) })) }],
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`Meta ${r.status}: ${body.slice(0, 300)}`);
    }
  }
}
