import { Injectable, Logger, OnModuleDestroy, OnModuleInit, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';
import { WhatsappAccountService, CredWa } from './whatsapp-account.service';
import { PlanesService } from '../subscriptions/planes.service';

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
 *   WHATSAPP_TEMPLATE_CONFIRM plantilla de confirmación inmediata (opcional), 4 variables:
 *     Hola {{1}}, tu turno con Dr/a. {{2}} quedó agendado para el {{3}} a las {{4}} hs. Te recordamos un día antes por acá.
 * Sin esas variables el pedido queda guardado y el consultorio lo envía a mano desde su lista.
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

  constructor(private db: DatabaseService, private config: ConfigService, private cuentas: WhatsappAccountService, private planes: PlanesService) {}

  onModuleInit() {
    // Revisa cada 10 minutos; el envío es idempotente (se marca antes de enviar)
    this.timer = setInterval(() => this.db.conBloqueo('tarea:recordatorios-whatsapp', () => this.procesar()).catch(e => this.logger.error(e.message)), 10 * 60_000);
    setTimeout(() => this.db.conBloqueo('tarea:recordatorios-whatsapp', () => this.procesar()).catch(e => this.logger.error(e.message)), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  get habilitado(): boolean {
    return !!this.config.get('WHATSAPP_TOKEN');
  }

  /**
   * ID del número central. Si el configurado no corresponde al token (por ejemplo, quedó el de una cuenta vieja),
   * se busca a partir del token: debug_token → cuentas de WhatsApp autorizadas → primer número.
   */
  private phoneIdCentralCache: string | null = null;
  private async phoneIdCentral(): Promise<string> {
    if (this.phoneIdCentralCache) return this.phoneIdCentralCache;
    const token = this.config.get<string>('WHATSAPP_TOKEN') || '';
    const g = async (path: string) => {
      const r = await fetch(`https://graph.facebook.com/v21.0/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(10_000) });
      return { ok: r.ok, j: await r.json().catch(() => ({})) as any };
    };
    const conf = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    if (conf && (await g(`${conf}?fields=id`).catch(() => ({ ok: false } as any))).ok) return (this.phoneIdCentralCache = conf);
    const dbg = await g(`debug_token?input_token=${encodeURIComponent(token)}`).catch(() => null);
    const wabas: string[] = (dbg?.j?.data?.granular_scopes || [])
      .filter((x: any) => /whatsapp_business/.test(x.scope)).flatMap((x: any) => x.target_ids || []);
    const wabaConf = this.config.get<string>('WHATSAPP_WABA_ID');
    if (wabaConf) wabas.unshift(wabaConf);
    for (const w of [...new Set(wabas)]) {
      const nums = await g(`${w}/phone_numbers?fields=id,display_phone_number`).catch(() => null);
      const id = nums?.j?.data?.[0]?.id;
      if (id) {
        this.logger.log(`Número central de WhatsApp detectado a partir del token (${nums!.j.data.length} número/s en la cuenta)`);
        return (this.phoneIdCentralCache = String(id));
      }
    }
    throw new Error('El token de WhatsApp no tiene acceso a ningún número');
  }

  /** Normaliza un celular argentino al formato que usa WhatsApp: 549 + característica + número */
  static normalizarCelular(raw: string): string | null {
    let d = String(raw || '').replace(/\D/g, '');
    if (!d) return null;
    if (d.startsWith('00')) d = d.slice(2);
    // Otros países (+598 Uruguay, +55 Brasil, +56 Chile, …): viene con código internacional; se usa tal cual (E.164)
    if (/^\s*(\+|00)/.test(String(raw)) && !d.startsWith('54')) return d.length >= 8 && d.length <= 15 ? d : null;
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

  /**
   * Mensaje de prueba: el médico manda la confirmación de ejemplo a un celular suyo (no al número conectado)
   * para comprobar que su WhatsApp quedó bien conectado. Devuelve el motivo en criollo si falla.
   */
  async prueba(doctorId: string, phone: string) {
    const numero = WhatsappReminderService.normalizarCelular(phone);
    if (!numero) throw new BadRequestException('Revisá el número: código de área y número, sin 0 ni 15');
    const cred = await this.cuentas.credenciales(doctorId);
    if (!cred && !this.habilitado) throw new BadRequestException('Primero conectá tu WhatsApp Business');
    const cuenta = await this.db.queryOne(`SELECT display_phone FROM doctor_whatsapp_accounts WHERE doctor_id = $1`, [doctorId]);
    const propio = String(cuenta?.display_phone || '').replace(/\D/g, '');
    if (propio && (propio === numero || propio === '54' + numero.slice(3))) {
      throw new BadRequestException('Ese es el número conectado: WhatsApp no deja que un número se escriba a sí mismo. Probá con otro celular (por ejemplo, tu personal o el de alguien de tu equipo).');
    }
    const d = await this.db.queryOne(`SELECT first_name, last_name FROM doctors WHERE id = $1`, [doctorId]);
    const plantilla = cred ? 'confirmacion_turno' : this.config.get<string>('WHATSAPP_TEMPLATE_CONFIRM');
    try {
      await this.enviarPlantilla(numero, ['(prueba)', [d?.first_name, d?.last_name].filter(Boolean).join(' ') || 'tu médico', 'lunes 10/11', '10:00'], plantilla, cred);
    } catch (e: any) {
      const m = String(e?.message || '');
      this.logger.warn(`Prueba de WhatsApp del médico ${doctorId}: ${m.replace(/\d{6,}/g, '#').slice(0, 200)}`);
      const motivo =
        /131030|allowed list/i.test(m) ? 'Ese celular no está autorizado. Con el número de prueba de Meta solo se puede escribir a los números de la lista de destinatarios permitidos.' :
        /131026/.test(m) ? 'Meta no pudo entregar el mensaje: revisá que ese celular tenga WhatsApp y esté bien escrito.' :
        /13200[01]/.test(m) ? 'Meta todavía está revisando el mensaje de confirmación. Probá de nuevo en un rato.' :
        /"code":\s*190|OAuth|token/i.test(m) ? 'La conexión con Meta venció. Desconectá tu WhatsApp y volvé a conectarlo.' :
        /131042|payment/i.test(m) ? 'Tu cuenta de WhatsApp Business no tiene un medio de pago cargado en Meta.' :
        /133010|not registered/i.test(m) ? 'El número conectado todavía no terminó de registrarse en Meta. Esperá unos minutos y probá de nuevo.' :
        'Meta rechazó el mensaje. Escribinos a support@tusrecetasmed.com y lo revisamos.';
      throw new BadRequestException(motivo);
    }
    await this.planes.registrarEnvio(doctorId, 'prueba', '+' + numero);
    return { ok: true, a: '+' + numero, desde: cuenta?.display_phone || 'número de prueba' };
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
              whatsapp_reminder_requested_at = now(), whatsapp_reminder_error = NULL,
              whatsapp_reminder_changes = COALESCE(whatsapp_reminder_changes, 0) + 1
        WHERE id = $1 AND status NOT IN ('cancelled','completed','no_show')
          AND whatsapp_reminder_sent_at IS NULL
          -- el paciente puede corregir su número hasta que se envíe, con un tope de cambios por turno
          AND COALESCE(whatsapp_reminder_changes, 0) < 5
        RETURNING id, date, start_time`,
      [br.appointment_id, '+' + numero],
    );
    if (!appt) throw new BadRequestException('Este turno ya no admite cambios en el recordatorio (o ya se envió)');

    // Si corrigió el celular queda en la reserva (el consultorio lo ve en el turno). La ficha del paciente
    // NO se modifica desde una página pública: la actualiza el consultorio si corresponde.
    const nuevo = '+' + numero;
    const anterior = String(br.phone || '');
    if (WhatsappReminderService.normalizarCelular(anterior) !== numero) {
      await this.db.query(`UPDATE booking_requests SET phone = $2 WHERE id = $1`, [br.id, nuevo]);
    }

    // Mensaje de confirmación inmediato: el paciente comprueba que su número quedó bien cargado.
    // Usa la plantilla WHATSAPP_TEMPLATE_CONFIRM (aprobada en Meta). Sin WhatsApp Business configurado no se envía nada.
    let confirmacion: 'enviada' | 'error' | 'no_configurado' | 'limite' = 'no_configurado';
    const medico = await this.db.queryOne(
      `SELECT od.doctor_id FROM appointments a JOIN organization_doctors od ON od.id = a.org_doctor_id WHERE a.id = $1`, [appt.id]);
    const cred = await this.cuentas.credenciales(medico?.doctor_id);
    const plantilla = cred ? 'confirmacion_turno' : this.config.get<string>('WHATSAPP_TEMPLATE_CONFIRM');
    const cupo = (cred || this.habilitado) && plantilla ? await this.planes.puedeEnviarWaAuto(medico?.doctor_id) : { ok: true };
    if (!cupo.ok) confirmacion = 'limite';
    else if ((cred || this.habilitado) && plantilla) {
      const t = await this.db.queryOne(
        `SELECT p.first_name, d.first_name || ' ' || d.last_name AS doctor_name,
                to_char(a.date, 'DD/MM') AS fecha, extract(dow from a.date)::int AS dow, to_char(a.start_time, 'HH24:MI') AS hora
           FROM appointments a JOIN patients p ON p.id = a.patient_id
           JOIN organization_doctors od ON od.id = a.org_doctor_id JOIN doctors d ON d.id = od.doctor_id
          WHERE a.id = $1`, [appt.id]);
      try {
        const wamid = await this.enviarPlantilla(numero, [t?.first_name || 'paciente', t?.doctor_name || '', t?.fecha ? `${['domingo','lunes','martes','miércoles','jueves','viernes','sábado'][t.dow] || ''} ${t.fecha}`.trim() : '', t?.hora || ''], plantilla, cred);
        confirmacion = 'enviada';
        await this.planes.registrarEnvio(medico?.doctor_id, 'confirmacion', '+' + numero, appt.id, wamid);
      } catch (e: any) {
        confirmacion = 'error';
        this.logger.warn(`Confirmación WhatsApp ${appt.id}: ${e.message}`);
      }
    }
    return { ok: true, phone: nuevo, appointmentId: appt.id, confirmacion, automatico: !!cred || this.habilitado };
  }

  /** Envía los recordatorios cuyo turno empieza dentro de las próximas 24 h (hora de Argentina) */
  async procesar(): Promise<{ enviados: number; errores: number; pendientes?: number }> {
    if (this.running) return { enviados: 0, errores: 0 };
    this.running = true;
    try {
      const pendientes = await this.db.queryMany(
        `UPDATE appointments a SET whatsapp_reminder_sent_at = now(), whatsapp_reminder_channel = 'auto'
          WHERE a.id IN (
            SELECT id FROM appointments
             WHERE whatsapp_reminder AND whatsapp_reminder_sent_at IS NULL
               AND whatsapp_auto_omitido_at IS NULL
               AND status IN ('confirmed','pending','pending_approval')
               -- Solo si hay por dónde enviarlo: el WhatsApp Business del médico o el número central de la plataforma
               AND ($1::boolean OR EXISTS (SELECT 1 FROM organization_doctors od2 JOIN doctor_whatsapp_accounts w ON w.doctor_id = od2.doctor_id
                                             WHERE od2.id = appointments.org_doctor_id))
               -- Lo pidió el paciente desde la confirmación (whatsapp_reminder_requested_at) o el médico tiene modo automático
               AND (whatsapp_reminder_requested_at IS NOT NULL
                    OR EXISTS (SELECT 1 FROM organization_doctors od JOIN doctor_reminder_settings rs ON rs.doctor_id = od.doctor_id
                                WHERE od.id = appointments.org_doctor_id AND rs.whatsapp_reminder_mode = 'auto'))
               AND (date + start_time) AT TIME ZONE 'America/Argentina/Buenos_Aires' > now()
               AND (date + start_time) AT TIME ZONE 'America/Argentina/Buenos_Aires' <= now() + interval '24 hours'
             LIMIT 50 FOR UPDATE SKIP LOCKED)
          RETURNING a.id`,
        [this.habilitado],
      );
      let enviados = 0, errores = 0;
      for (const { id } of pendientes) {
        const t = await this.db.queryOne(
          `SELECT a.whatsapp_reminder_phone AS phone, a.start_time, d.id AS doctor_id,
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
        // Cupo mensual del plan: si se alcanzó, el recordatorio queda para enviarlo a mano desde el Dashboard
        const cupo = await this.planes.puedeEnviarWaAuto(t.doctor_id);
        if (!cupo.ok) {
          await this.db.query(
            `UPDATE appointments SET whatsapp_reminder_sent_at = NULL, whatsapp_reminder_channel = NULL, whatsapp_auto_omitido_at = now(),
                    whatsapp_reminder_error = $2 WHERE id = $1`,
            [id, `Se alcanzó el cupo de ${cupo.limite} avisos automáticos del mes: envialo desde el Dashboard`],
          );
          continue;
        }
        try {
          const cred = await this.cuentas.credenciales(t.doctor_id);
          const wamid = await this.enviarPlantilla(String(t.phone).replace(/\D/g, ''), [
            t.first_name || 'paciente', t.doctor_name, String(t.start_time).substring(0, 5), t.lugar || 'el consultorio',
          ], cred ? 'recordatorio_turno' : undefined, cred);
          if (wamid) await this.db.query(`UPDATE appointments SET whatsapp_reminder_wamid = $2, whatsapp_reminder_status = 'sent' WHERE id = $1`, [id, wamid]);
          await this.planes.registrarEnvio(t.doctor_id, 'recordatorio', t.phone, id, wamid);
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
       RETURNING whatsapp_reminder_mode, whatsapp_reminder_all, wa_respuestas_auto, wa_respuesta_texto`,
      [doctorId],
    );
    const propio = !!(await this.cuentas.credenciales(doctorId));
    return { modo: r.whatsapp_reminder_mode, todos: r.whatsapp_reminder_all, automaticoDisponible: this.habilitado || propio, whatsappPropio: propio,
      respuestasAuto: r.wa_respuestas_auto !== false, respuestaTexto: r.wa_respuesta_texto || '' };
  }

  async setModo(doctorId: string, modo?: string, todos?: boolean, respuestasAuto?: boolean, respuestaTexto?: string) {
    if (modo && !['manual', 'auto'].includes(modo)) throw new BadRequestException('Modo inválido');
    if (modo === 'auto' && !this.habilitado && !(await this.cuentas.credenciales(doctorId))) throw new BadRequestException('Para el envío automático conectá tu WhatsApp Business. Mientras tanto usá el modo manual.');
    await this.db.query(
      `INSERT INTO doctor_reminder_settings (doctor_id, whatsapp_reminder_mode, whatsapp_reminder_all) VALUES ($1, COALESCE($2,'manual'), COALESCE($3,true))
       ON CONFLICT (doctor_id) DO UPDATE SET whatsapp_reminder_mode = COALESCE($2, doctor_reminder_settings.whatsapp_reminder_mode),
         whatsapp_reminder_all = COALESCE($3, doctor_reminder_settings.whatsapp_reminder_all), updated_at = now()`,
      [doctorId, modo ?? null, typeof todos === 'boolean' ? todos : null],
    );
    if (typeof respuestasAuto === 'boolean' || typeof respuestaTexto === 'string') {
      await this.db.query(
        `UPDATE doctor_reminder_settings SET wa_respuestas_auto = COALESCE($2, wa_respuestas_auto),
                wa_respuesta_texto = CASE WHEN $3::text IS NULL THEN wa_respuesta_texto ELSE NULLIF(trim($3::text), '') END, updated_at = now()
          WHERE doctor_id = $1`,
        [doctorId, typeof respuestasAuto === 'boolean' ? respuestasAuto : null, typeof respuestaTexto === 'string' ? respuestaTexto.slice(0, 600) : null],
      );
    }
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

  /** Envía una plantilla. Con `cred` sale desde el WhatsApp Business del médico; si no, desde el número central */
  private async enviarPlantilla(to: string, vars: string[], plantilla?: string, cred?: CredWa | null): Promise<string | null> {
    try {
      return await this.enviarPlantillaA(to, vars, plantilla, cred);
    } catch (e: any) {
      // Celulares argentinos: Meta a veces registra el número sin el 9 (54 + característica + número).
      // Si responde "no está en la lista permitida" (131030) o "número inválido" (131026), se reintenta sin el 9.
      if (/^549\d{10}$/.test(to) && /131030|131026|not in allowed list/i.test(String(e?.message))) {
        // Variantes: sin el 9, y con el "15" después de la característica (2, 3 o 4 dígitos)
        const nac = to.slice(3);
        const variantes = ['54' + nac, ...[4, 3, 2].map((n) => '54' + nac.slice(0, n) + '15' + nac.slice(n))];
        let ultimo = e;
        for (const [i, v] of variantes.entries()) {
          try {
            const id = await this.enviarPlantillaA(v, vars, plantilla, cred);
            this.logger.log(`WhatsApp enviado con la variante ${i + 1} del número argentino`);
            return id;
          } catch (e2: any) {
            ultimo = e2;
            if (!/131030|131026|not in allowed list/i.test(String(e2?.message))) throw e2;
          }
        }
        throw ultimo;
      }
      throw e;
    }
  }

  private async enviarPlantillaA(to: string, vars: string[], plantilla?: string, cred?: CredWa | null) {
    const phoneId = cred?.phoneNumberId || await this.phoneIdCentral();
    const token = cred?.token || this.config.get('WHATSAPP_TOKEN');
    const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: plantilla || this.config.get('WHATSAPP_TEMPLATE') || 'recordatorio_turno',
          language: { code: cred ? 'es_AR' : (this.config.get('WHATSAPP_TEMPLATE_LANG') || 'es_AR') },
          components: [{ type: 'body', parameters: vars.map(text => ({ type: 'text', text: String(text).slice(0, 200) })) }],
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      // Número central de prueba: si la plantilla todavía no está aprobada (132001), se manda la de ejemplo de Meta
      if (!cred && plantilla !== 'hello_world' && /"code":\s*13200[01]/.test(body)) {
        this.logger.warn(`Plantilla ${plantilla} sin aprobar en el número central; se envía hello_world`);
        return this.enviarHelloWorld(to, phoneId, token);
      }
      throw new Error(`Meta ${r.status}: ${body.slice(0, 300)}`);
    }
    const j: any = await r.json().catch(() => ({}));
    return (j?.messages?.[0]?.id as string) || null;
  }

  /** Mensaje de texto libre (solo dentro de las 24 h desde que escribió el paciente): respuestas automáticas */
  async enviarTexto(to: string, texto: string, cred?: CredWa | null): Promise<string | null> {
    const phoneId = cred?.phoneNumberId || await this.phoneIdCentral();
    const token = cred?.token || this.config.get('WHATSAPP_TOKEN');
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: texto.slice(0, 4000), preview_url: true } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`Meta ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
    const j: any = await r.json().catch(() => ({}));
    return (j?.messages?.[0]?.id as string) || null;
  }

  /** ¿El número central atiende este phone_number_id? (para los mensajes entrantes del webhook) */
  async esNumeroCentral(phoneNumberId: string): Promise<boolean> {
    if (!this.habilitado) return false;
    try { return (await this.phoneIdCentral()) === String(phoneNumberId); } catch { return false; }
  }

  private async enviarHelloWorld(to: string, phoneId: string, token: string) {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template: { name: 'hello_world', language: { code: 'en_US' } } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`Meta ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
    const j: any = await r.json().catch(() => ({}));
    return (j?.messages?.[0]?.id as string) || null;
  }
}
