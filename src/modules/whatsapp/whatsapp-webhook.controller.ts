import { Body, Controller, ForbiddenException, Get, HttpCode, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { Public } from '../../common/guards/auth.guard';
import { DatabaseService } from '../../database/database.service';

/**
 * Webhook de WhatsApp (Meta Cloud API). URL para cargar en Meta:
 *   https://tusrecetasmed.com/api/v1/webhooks/whatsapp
 * - GET: verificación (hub.verify_token debe coincidir con WHATSAPP_VERIFY_TOKEN)
 * - POST: estados de mensajes (enviado/entregado/leído/falló) y mensajes entrantes.
 *   Se valida la firma X-Hub-Signature-256 con META_APP_SECRET. Se guarda primero y después se responde 200,
 *   así Meta reintenta si algo falla.
 */
@Public()
@Controller('api/v1/webhooks/whatsapp')
export class WhatsappWebhookController {
  private readonly logger = new Logger('WhatsappWebhook');
  constructor(private config: ConfigService, private db: DatabaseService) {}

  @Get()
  verificar(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: Response) {
    const esperado = this.config.get<string>('WHATSAPP_VERIFY_TOKEN');
    if (mode === 'subscribe' && esperado && token === esperado) return res.status(200).type('text/plain').send(String(challenge ?? ''));
    return res.status(403).send('Token de verificación inválido');
  }

  @Post()
  @HttpCode(200)
  async recibir(@Req() req: Request & { rawBody?: Buffer }, @Body() body: any) {
    const secreto = this.config.get<string>('META_APP_SECRET');
    if (!secreto) throw new ForbiddenException('Webhook no configurado');
    const firma = String(req.headers['x-hub-signature-256'] || '');
    const esperada = 'sha256=' + createHmac('sha256', secreto).update(req.rawBody || Buffer.from(JSON.stringify(body ?? {}))).digest('hex');
    if (firma.length !== esperada.length || !timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) {
      this.logger.warn('Firma de webhook inválida');
      throw new ForbiddenException('Firma inválida');
    }

    for (const entry of body?.entry || []) {
      for (const ch of entry?.changes || []) {
        const v = ch?.value || {};
        const pnid = v?.metadata?.phone_number_id || null;
        for (const st of v.statuses || []) {
          await this.db.query(
            `INSERT INTO whatsapp_events (kind, wamid, status, phone_number_id, from_phone, payload) VALUES ('status',$1,$2,$3,$4,$5)`,
            [st.id, st.status, pnid, st.recipient_id || null, st],
          );
          const err = st.status === 'failed' ? (st.errors?.[0]?.title || st.errors?.[0]?.message || 'Falló el envío') : null;
          await this.db.query(
            `UPDATE appointments SET whatsapp_reminder_status = $2, whatsapp_reminder_error = COALESCE($3, whatsapp_reminder_error)
              WHERE whatsapp_reminder_wamid = $1`,
            [st.id, st.status, err],
          );
        }
        for (const m of v.messages || []) {
          await this.db.query(
            `INSERT INTO whatsapp_events (kind, wamid, phone_number_id, from_phone, payload) VALUES ('message',$1,$2,$3,$4)`,
            [m.id, pnid, m.from || null, m],
          );
        }
        if (!(v.statuses || []).length && !(v.messages || []).length) {
          await this.db.query(`INSERT INTO whatsapp_events (kind, payload) VALUES ('other',$1)`, [ch]);
        }
      }
    }
    return { ok: true };
  }
}
