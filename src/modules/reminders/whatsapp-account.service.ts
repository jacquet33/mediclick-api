import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';

const GRAPH = 'https://graph.facebook.com/v21.0';

/** Plantillas que se crean en la cuenta de WhatsApp Business de cada médico al conectarla */
export const PLANTILLAS = [
  {
    name: 'recordatorio_turno',
    text: 'Hola {{1}}, te recordamos tu turno de mañana con Dr/a. {{2}} a las {{3}} hs en {{4}}. Si no podés asistir o tenés alguna duda, respondé este mensaje.',
    example: ['Juan', 'Ana Pérez', '10:00', 'Consultorio Centro'],
  },
  {
    name: 'confirmacion_turno',
    text: 'Hola {{1}}, tu turno con Dr/a. {{2}} quedó agendado para el {{3}} a las {{4}} hs. Te lo vamos a recordar el día anterior por este medio. Si tenés alguna duda, respondé este mensaje.',
    example: ['Juan', 'Ana Pérez', 'jueves 12/11', '10:00'],
  },
];

export interface CredWa { phoneNumberId: string; token: string }

/**
 * Conexión del WhatsApp Business de cada médico (registro integrado de Meta / "Embedded Signup").
 * Necesita: META_APP_ID, META_APP_SECRET, META_ES_CONFIG_ID (Configuration ID del registro integrado) y ENCRYPTION_KEY.
 */
@Injectable()
export class WhatsappAccountService {
  private readonly logger = new Logger('WhatsappAccount');
  constructor(private db: DatabaseService, private config: ConfigService) {}

  get disponible() {
    return !!(this.config.get('META_APP_ID') && this.config.get('META_APP_SECRET') && this.config.get('META_ES_CONFIG_ID') && this.config.get('ENCRYPTION_KEY'));
  }

  async estado(doctorId: string) {
    const r = await this.db.queryOne(
      `SELECT display_phone, verified_name, connected_at, templates FROM doctor_whatsapp_accounts WHERE doctor_id = $1`, [doctorId]);
    const d = await this.db.queryOne(`SELECT phone FROM doctors WHERE id = $1`, [doctorId]);
    return {
      disponible: this.disponible,
      telefonoMedico: d?.phone || null,
      central: !!this.config.get('WHATSAPP_TOKEN'),
      appId: this.config.get('META_APP_ID') || null,
      configId: this.config.get('META_ES_CONFIG_ID') || null,
      conectado: !!r,
      numero: r?.display_phone || null,
      nombre: r?.verified_name || null,
      conectadoEl: r?.connected_at || null,
      plantillas: r?.templates || null,
    };
  }

  private async graph(path: string, token: string, init?: { method?: string; body?: any }) {
    const r = await fetch(`${GRAPH}/${path}`, {
      method: init?.method || 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message || `Meta ${r.status}`);
    return j;
  }

  /** El médico terminó el registro integrado: se cambia el código por un token y se guarda su número */
  async conectar(doctorId: string, dto: { code?: string; wabaId?: string; phoneNumberId?: string }) {
    if (!this.disponible) throw new BadRequestException('La conexión con WhatsApp todavía no está habilitada en la plataforma');
    const code = String(dto?.code || ''), wabaId = String(dto?.wabaId || ''), phoneId = String(dto?.phoneNumberId || '');
    if (!code || !/^\d+$/.test(wabaId) || !/^\d+$/.test(phoneId)) throw new BadRequestException('Faltan datos de Meta. Probá conectar de nuevo.');

    const q = new URLSearchParams({ client_id: this.config.get('META_APP_ID')!, client_secret: this.config.get('META_APP_SECRET')!, code });
    const tr = await fetch(`${GRAPH}/oauth/access_token?${q}`, { signal: AbortSignal.timeout(15_000) });
    const tj: any = await tr.json().catch(() => ({}));
    if (!tr.ok || !tj.access_token) throw new BadRequestException('Meta no aceptó la conexión: ' + (tj?.error?.message || tr.status));
    const token = tj.access_token as string;

    const info = await this.graph(`${phoneId}?fields=display_phone_number,verified_name`, token).catch(() => ({} as any));
    // Que los avisos (entregado, leído, respuestas) de su número lleguen a nuestro webhook
    await this.graph(`${wabaId}/subscribed_apps`, token, { method: 'POST' }).catch((e) => this.logger.warn(`subscribed_apps ${wabaId}: ${e.message}`));
    const plantillas = await this.crearPlantillas(wabaId, token);

    await this.db.query(
      `INSERT INTO doctor_whatsapp_accounts (doctor_id, waba_id, phone_number_id, display_phone, verified_name, token_enc, templates)
       VALUES ($1,$2,$3,$4,$5, pgp_sym_encrypt($6, $7), $8)
       ON CONFLICT (doctor_id) DO UPDATE SET waba_id = EXCLUDED.waba_id, phone_number_id = EXCLUDED.phone_number_id,
         display_phone = EXCLUDED.display_phone, verified_name = EXCLUDED.verified_name, token_enc = EXCLUDED.token_enc,
         templates = EXCLUDED.templates, connected_at = now(), updated_at = now()`,
      [doctorId, wabaId, phoneId, info.display_phone_number || null, info.verified_name || null, token, this.config.get('ENCRYPTION_KEY'), JSON.stringify(plantillas)],
    );
    // Con su número conectado, los recordatorios salen solos
    await this.db.query(
      `INSERT INTO doctor_reminder_settings (doctor_id, whatsapp_reminder_mode) VALUES ($1, 'auto')
       ON CONFLICT (doctor_id) DO UPDATE SET whatsapp_reminder_mode = 'auto', updated_at = now()`, [doctorId]);
    this.logger.log(`WhatsApp conectado para el médico ${doctorId} (${info.display_phone_number || phoneId})`);
    return this.estado(doctorId);
  }

  private async crearPlantillas(wabaId: string, token: string) {
    const out: Record<string, string> = {};
    for (const p of PLANTILLAS) {
      try {
        const r = await this.graph(`${wabaId}/message_templates`, token, {
          method: 'POST',
          body: { name: p.name, language: 'es_AR', category: 'UTILITY', components: [{ type: 'BODY', text: p.text, example: { body_text: [p.example] } }] },
        });
        out[p.name] = r?.status || 'PENDING';
      } catch (e: any) {
        // Si ya existe en su cuenta, Meta responde error: la usamos igual
        out[p.name] = /exist/i.test(e.message) ? 'EXISTE' : 'ERROR: ' + String(e.message).slice(0, 120);
      }
    }
    return out;
  }

  async desconectar(doctorId: string) {
    await this.db.query(`DELETE FROM doctor_whatsapp_accounts WHERE doctor_id = $1`, [doctorId]);
    await this.db.query(`UPDATE doctor_reminder_settings SET whatsapp_reminder_mode = 'manual', updated_at = now() WHERE doctor_id = $1`, [doctorId]);
    return this.estado(doctorId);
  }

  /** Número y token del médico para enviar (null si no conectó su WhatsApp) */
  async credenciales(doctorId: string): Promise<CredWa | null> {
    const key = this.config.get('ENCRYPTION_KEY');
    if (!key || !doctorId) return null;
    const r = await this.db.queryOne(
      `SELECT phone_number_id, pgp_sym_decrypt(token_enc, $2) AS token FROM doctor_whatsapp_accounts WHERE doctor_id = $1`, [doctorId, key]).catch(() => null);
    return r ? { phoneNumberId: r.phone_number_id, token: r.token } : null;
  }

  async conectados(): Promise<Set<string>> {
    const rows = await this.db.queryMany(`SELECT doctor_id FROM doctor_whatsapp_accounts`).catch(() => []);
    return new Set(rows.map((r: any) => r.doctor_id));
  }
}
