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
        `UPDATE appointments a SET whatsapp_reminder_sent_at = now()
          WHERE a.id IN (
            SELECT id FROM appointments
             WHERE whatsapp_reminder AND whatsapp_reminder_sent_at IS NULL
               AND status IN ('confirmed','pending','pending_approval')
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
