import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';
import { WhatsappReminderService } from '../reminders/whatsapp-reminder.service';
import { WhatsappAccountService, CredWa } from '../reminders/whatsapp-account.service';
import { AppointmentService } from '../appointments/appointment.service';
import { PushNotificationService } from '../push/push.service';
import { PlanesService } from '../subscriptions/planes.service';

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Normaliza el texto del paciente: minúsculas, sin acentos ni signos */
export function normalizarTexto(t: string): string {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Qué quiere hacer el paciente según lo que respondió */
export function intencion(texto: string): 'confirmar' | 'cancelar' | 'quiere_cancelar' | 'otro' {
  const t = normalizarTexto(texto);
  if (!t) return 'otro';
  if (/^(cancelar|cancelo|cancela|cancelar turno|cancelar el turno|si cancelar|si cancelo)$/.test(t)) return 'cancelar';
  if (/^(2|no)$/.test(t) || /(cancel|no puedo|no voy|no asistire|no podre|no llego|reprogram|cambiar (el |mi )?turno|otro dia|otro horario)/.test(t)) return 'quiere_cancelar';
  if (/^(1|si+|sii+|s|confirmo|confirmado|confirmar|confirmadisimo|ok+|okey|oka|dale|perfecto|genial|listo|voy|si voy|ahi estare|alli estare|asistire|ahi voy|si confirmo|confirmo asistencia|si gracias|si muchas gracias|gracias si)$/.test(t)) return 'confirmar';
  return 'otro';
}

/**
 * Respuestas automáticas a los mensajes que los pacientes mandan al WhatsApp del consultorio
 * (llegan por el webhook de Meta). Son mensajes de servicio: no cuentan para el cupo del plan.
 * - "SI" / "1" / "confirmo" → marca que el paciente confirmó y le responde
 * - "CANCELAR" → cancela el turno (libera el horario y avisa a la lista de espera y al médico)
 * - "no puedo", "cambiar el turno"… → le pregunta si quiere cancelar
 * - cualquier otra cosa → respuesta automática (como mucho una cada 12 h por paciente), configurable
 */
@Injectable()
export class WhatsappRespuestasService {
  private readonly logger = new Logger('WhatsappRespuestas');
  constructor(
    private db: DatabaseService,
    private config: ConfigService,
    private wa: WhatsappReminderService,
    private cuentas: WhatsappAccountService,
    private turnos: AppointmentService,
    private push: PushNotificationService,
    private planes: PlanesService,
  ) {}

  private get base() { return this.config.get<string>('BASE_URL') || 'https://tusrecetasmed.com'; }

  async procesar(value: any) {
    const pnid = String(value?.metadata?.phone_number_id || '');
    for (const m of value?.messages || []) {
      try {
        await this.unMensaje(pnid, m);
      } catch (e: any) {
        this.logger.warn(`No se pudo responder un mensaje entrante: ${String(e?.message).replace(/\d{6,}/g, '#').slice(0, 200)}`);
      }
    }
  }

  private async unMensaje(pnid: string, m: any) {
    const from = String(m?.from || '').replace(/\D/g, '');
    if (!from) return;
    const texto = m?.text?.body || m?.button?.text || m?.button?.payload || m?.interactive?.button_reply?.title || m?.interactive?.list_reply?.title || '';

    // ¿De qué consultorio es el número que recibió el mensaje?
    const cuenta = pnid ? await this.db.queryOne<{ doctor_id: string }>(`SELECT doctor_id FROM doctor_whatsapp_accounts WHERE phone_number_id = $1`, [pnid]) : null;
    const central = !cuenta && await this.wa.esNumeroCentral(pnid);
    if (!cuenta && !central) return;
    const cred: CredWa | null = cuenta ? await this.cuentas.credenciales(cuenta.doctor_id) : null;

    // Próximo turno de ese paciente (comparando los últimos 10 dígitos, así da igual el 9 o el 15)
    const clave = (WhatsappReminderService.normalizarCelular('+' + from) || from).slice(-10);
    const turno = await this.db.queryOne<any>(
      `SELECT a.id, a.organization_id, a.status, to_char(a.date,'YYYY-MM-DD') AS fecha, extract(dow from a.date)::int AS dow,
              to_char(a.date,'DD/MM') AS ddmm, to_char(a.start_time,'HH24:MI') AS hora, a.paciente_confirmo_at,
              p.first_name, p.first_name || ' ' || p.last_name AS paciente, od.doctor_id,
              d.first_name || ' ' || d.last_name AS medico, bs.public_slug
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN organization_doctors od ON od.id = a.org_doctor_id
         JOIN doctors d ON d.id = od.doctor_id
         LEFT JOIN booking_settings bs ON bs.org_doctor_id = od.id
        WHERE a.status NOT IN ('cancelled','completed','no_show')
          AND (a.date + a.start_time) AT TIME ZONE 'America/Argentina/Buenos_Aires' > now() - interval '2 hours'
          AND right(regexp_replace(COALESCE(a.whatsapp_reminder_phone, p.phone, ''), '\\D', '', 'g'), 10) = $1
          AND ($2::uuid IS NULL AND NOT EXISTS (SELECT 1 FROM doctor_whatsapp_accounts w WHERE w.doctor_id = od.doctor_id)
               OR od.doctor_id = $2::uuid)
        ORDER BY a.date, a.start_time LIMIT 1`,
      [clave, cuenta?.doctor_id || null],
    );
    const doctorId = turno?.doctor_id || cuenta?.doctor_id || null;

    const conf = doctorId ? await this.db.queryOne<{ wa_respuestas_auto: boolean; wa_respuesta_texto: string | null }>(
      `SELECT wa_respuestas_auto, wa_respuesta_texto FROM doctor_reminder_settings WHERE doctor_id = $1`, [doctorId]) : null;
    if (conf && conf.wa_respuestas_auto === false) return; // el médico responde a mano

    const responder = async (msg: string, tipo = 'respuesta') => {
      try {
        const wamid = await this.wa.enviarTexto(from, msg, cred);
        await this.planes.registrarEnvio(doctorId, tipo, '+' + from, turno?.id, wamid);
      } catch (e: any) {
        this.logger.warn(`No se pudo enviar la respuesta automática: ${String(e?.message).replace(/\d{6,}/g, '#').slice(0, 200)}`);
      }
    };
    const cuando = turno ? `${DIAS[turno.dow]} ${turno.ddmm} a las ${turno.hora} hs` : '';
    const link = turno?.public_slug ? `${this.base}/${turno.public_slug}` : this.base;
    const accion = intencion(texto);

    if (turno && accion === 'confirmar') {
      await this.db.query(`UPDATE appointments SET paciente_confirmo_at = COALESCE(paciente_confirmo_at, now()) WHERE id = $1`, [turno.id]);
      await responder(`¡Gracias, ${turno.first_name}! Tu turno del ${cuando} con Dr/a. ${turno.medico} quedó confirmado. Te esperamos.`);
      return;
    }
    if (turno && accion === 'cancelar') {
      await this.turnos.updateStatus(turno.id, turno.organization_id, 'cancelled', 'Cancelado por el paciente por WhatsApp');
      await this.push.notifyAppointmentCancelled(turno.doctor_id, { date: turno.fecha, startTime: turno.hora, patientName: turno.paciente, reason: 'por WhatsApp' }).catch(() => {});
      await responder(`Listo, ${turno.first_name}: cancelamos tu turno del ${cuando}. Si querés sacar uno nuevo: ${link}`);
      this.logger.log(`Turno ${turno.id} cancelado por el paciente por WhatsApp`);
      return;
    }
    if (turno && accion === 'quiere_cancelar') {
      await responder(`${turno.first_name}, ¿querés cancelar tu turno del ${cuando}? Respondé *CANCELAR* para confirmarlo. Si preferís otro día, después de cancelarlo podés sacar uno nuevo en ${link}`, 'pregunta_cancelar');
      return;
    }

    // Cualquier otro mensaje: una respuesta automática como mucho cada 12 h por paciente
    const reciente = await this.db.queryOne(
      `SELECT 1 FROM whatsapp_envios WHERE telefono = $1 AND tipo IN ('respuesta','pregunta_cancelar') AND created_at > now() - interval '12 hours'`, ['+' + from]);
    if (reciente) return;
    if (!doctorId) {
      await responder('Hola, este número envía los avisos de turnos de TusRecetasMed. Para cualquier consulta comunicate con tu consultorio.');
      return;
    }
    const propio = conf?.wa_respuesta_texto?.trim();
    const proximo = turno ? `\n\nTu próximo turno: ${cuando}. Respondé *SI* para confirmarlo o *CANCELAR* si no podés asistir.` : `\n\nPara sacar turno: ${link}`;
    await responder((propio || `Hola, gracias por escribir. Recibimos tu mensaje y te respondemos a la brevedad.`) + proximo);
  }
}
