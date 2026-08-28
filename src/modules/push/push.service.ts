import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../../database/database.service';
import * as https from 'https';
import * as crypto from 'crypto';

interface PushPayload {
  title: string;
  body: string;
  category?: string;
  data?: Record<string, unknown>;
  badge?: number;
  sound?: string;
}

export interface SendResult {
  sent: number;
  failed: number;
  errors: string[];
}

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private apnsToken: string | null = null;
  private apnsTokenExpiry = 0;

  constructor(
    private db: DatabaseService,
    private config: ConfigService,
    private jwtService: JwtService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // DEVICE TOKEN MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  async registerToken(
    ownerType: 'doctor' | 'patient' | 'staff',
    ownerId: string,
    token: string,
    platform: 'ios' | 'android' | 'web',
    meta?: { deviceName?: string; appVersion?: string; osVersion?: string },
  ) {
    const ownerCol = ownerType === 'doctor' ? 'doctor_id'
      : ownerType === 'patient' ? 'patient_auth_id' : 'staff_id';

    // Upsert: si el token ya existe, actualizar owner
    await this.db.query(
      `INSERT INTO device_tokens (${ownerCol}, token, platform, device_name, app_version, os_version, is_active, last_used_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
       ON CONFLICT (token) DO UPDATE SET
         ${ownerCol} = $1, is_active = true, last_used_at = NOW(),
         device_name = COALESCE($4, device_tokens.device_name),
         app_version = COALESCE($5, device_tokens.app_version),
         os_version = COALESCE($6, device_tokens.os_version)`,
      [ownerId, token, platform, meta?.deviceName || null, meta?.appVersion || null, meta?.osVersion || null],
    );

    this.logger.log(`Token registered: ${ownerType}=${ownerId} platform=${platform}`);
    return { ok: true };
  }

  async unregisterToken(token: string) {
    await this.db.query('UPDATE device_tokens SET is_active = false WHERE token = $1', [token]);
    return { ok: true };
  }

  // ═══════════════════════════════════════════════════════════
  // SEND TO SPECIFIC USER
  // ═══════════════════════════════════════════════════════════

  /** Enviar push a un doctor */
  async sendToDoctor(doctorId: string, payload: PushPayload): Promise<SendResult> {
    return this.sendToUser('doctor_id', doctorId, 'doctor', payload);
  }

  /** Enviar push a un paciente */
  async sendToPatient(patientAuthId: string, payload: PushPayload): Promise<SendResult> {
    return this.sendToUser('patient_auth_id', patientAuthId, 'patient', payload);
  }

  /** Enviar push a un staff */
  async sendToStaff(staffId: string, payload: PushPayload): Promise<SendResult> {
    return this.sendToUser('staff_id', staffId, 'staff', payload);
  }

  /** Enviar push a un paciente por patient_id (busca su patient_auth) */
  async sendToPatientByPatientId(patientId: string, payload: PushPayload): Promise<SendResult> {
    const auth = await this.db.queryOne(
      'SELECT id FROM patient_auth WHERE patient_id = $1', [patientId],
    );
    if (!auth) return { sent: 0, failed: 0, errors: ['Patient has no auth account'] };
    return this.sendToPatient(auth.id, payload);
  }

  private async sendToUser(
    column: string, userId: string, recipientType: string, payload: PushPayload,
  ): Promise<SendResult> {
    const tokens = await this.db.queryMany(
      `SELECT id, token, platform FROM device_tokens WHERE ${column} = $1 AND is_active = true`,
      [userId],
    );

    if (!tokens.length) {
      this.logger.debug(`No active tokens for ${column}=${userId}`);
      return { sent: 0, failed: 0, errors: [] };
    }

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const dt of tokens) {
      try {
        if (dt.platform === 'ios') {
          await this.sendAPNs(dt.token, payload);
        } else {
          // Web/Android: log for now (FCM pendiente)
          this.logger.log(`[${dt.platform}] Would send to ${dt.token.substring(0, 20)}...`);
        }

        await this.logPush(dt.id, recipientType, userId, payload, 'sent');
        sent++;
      } catch (err: any) {
        const errMsg = err.message || 'Unknown error';
        errors.push(errMsg);
        await this.logPush(dt.id, recipientType, userId, payload, 'failed', errMsg);
        failed++;

        // Si el token es inválido, desactivarlo
        if (errMsg.includes('BadDeviceToken') || errMsg.includes('Unregistered') || errMsg.includes('410')) {
          await this.db.query('UPDATE device_tokens SET is_active = false WHERE id = $1', [dt.id]);
          this.logger.warn(`Disabled invalid token: ${dt.id}`);
        }
      }
    }

    return { sent, failed, errors };
  }

  // ═══════════════════════════════════════════════════════════
  // TRIGGERED NOTIFICATIONS (llamadas desde otros servicios)
  // ═══════════════════════════════════════════════════════════

  /** Recordatorio de turno (N minutos antes) */
  async notifyAppointmentReminder(doctorId: string, patientId: string, appt: {
    date: string; startTime: string; patientName: string; doctorName: string; orgName: string;
  }) {
    // Al doctor
    await this.sendToDoctor(doctorId, {
      title: '⏰ Próximo turno',
      body: `${appt.patientName} a las ${appt.startTime.substring(0, 5)}`,
      category: 'appointment_reminder',
      data: { type: 'appointment_reminder', date: appt.date, startTime: appt.startTime },
    });

    // Al paciente
    await this.sendToPatientByPatientId(patientId, {
      title: '⏰ Recordatorio de turno',
      body: `Tu turno con Dr/a. ${appt.doctorName} es hoy a las ${appt.startTime.substring(0, 5)} en ${appt.orgName}`,
      category: 'appointment_reminder',
      data: { type: 'appointment_reminder', date: appt.date, startTime: appt.startTime },
    });
  }

  /** Nuevo mensaje */
  async notifyNewMessage(recipientType: 'doctor' | 'patient', recipientId: string, senderName: string, preview: string) {
    const payload: PushPayload = {
      title: `💬 ${senderName}`,
      body: preview.length > 100 ? preview.substring(0, 100) + '...' : preview,
      category: 'new_message',
      data: { type: 'new_message' },
      sound: 'default',
    };

    if (recipientType === 'doctor') {
      await this.sendToDoctor(recipientId, payload);
    } else {
      await this.sendToPatientByPatientId(recipientId, payload);
    }
  }

  /** Turno cancelado — avisar al doctor */
  async notifyAppointmentCancelled(doctorId: string, appt: {
    date: string; startTime: string; patientName: string; reason?: string;
  }) {
    await this.sendToDoctor(doctorId, {
      title: '❌ Turno cancelado',
      body: `${appt.patientName} canceló el turno de las ${appt.startTime.substring(0, 5)} (${appt.date})${appt.reason ? ': ' + appt.reason : ''}`,
      category: 'appointment_cancelled',
      data: { type: 'appointment_cancelled', date: appt.date },
    });
  }

  /** Slot liberado — avisar a pacientes en waitlist */
  async notifySlotReleased(waitlistContactPhone: string, details: {
    date: string; startTime: string; doctorName: string;
  }) {
    // Buscar si el paciente del waitlist tiene cuenta con push
    // Por ahora solo loguear — se envía por SMS/WhatsApp cuando se integre
    this.logger.log(`Slot released notification: ${waitlistContactPhone} for ${details.date} ${details.startTime}`);
  }

  /** Turno confirmado — avisar al paciente */
  async notifyAppointmentConfirmed(patientId: string, appt: {
    date: string; startTime: string; doctorName: string; orgName: string;
  }) {
    await this.sendToPatientByPatientId(patientId, {
      title: '✅ Turno confirmado',
      body: `Tu turno con Dr/a. ${appt.doctorName} el ${appt.date} a las ${appt.startTime.substring(0, 5)} en ${appt.orgName}`,
      category: 'appointment_confirmed',
      data: { type: 'appointment_confirmed', date: appt.date },
      sound: 'default',
    });
  }

  /** Receta emitida — avisar al paciente */
  async notifyPrescriptionReady(patientId: string, doctorName: string, diagnosis: string) {
    await this.sendToPatientByPatientId(patientId, {
      title: '📋 Nueva receta',
      body: `Dr/a. ${doctorName} emitió una receta: ${diagnosis}`,
      category: 'prescription_ready',
      data: { type: 'prescription_ready' },
    });
  }

  // ═══════════════════════════════════════════════════════════
  // APNs (Apple Push Notification Service)
  // ═══════════════════════════════════════════════════════════

  private async sendAPNs(deviceToken: string, payload: PushPayload): Promise<void> {
    const keyId = this.config.get('APNS_KEY_ID');
    const teamId = this.config.get('APNS_TEAM_ID');
    const keyContent = this.config.get('APNS_KEY');
    const bundleId = this.config.get('APNS_BUNDLE_ID') || 'com.mediclick.app';
    const isProduction = this.config.get('APNS_PRODUCTION') !== 'false';

    if (!keyId || !teamId || !keyContent) {
      this.logger.warn('APNs not configured — skipping push');
      return;
    }

    const apnsPayload = {
      aps: {
        alert: { title: payload.title, body: payload.body },
        badge: payload.badge ?? 1,
        sound: payload.sound || 'default',
        'mutable-content': 1,
        'thread-id': payload.category || 'general',
      },
      ...payload.data,
    };

    const token = this.getApnsJwt(keyId, teamId, keyContent);
    const host = isProduction ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: host,
        port: 443,
        path: `/3/device/${deviceToken}`,
        method: 'POST',
        headers: {
          'authorization': `bearer ${token}`,
          'apns-topic': bundleId,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'apns-expiration': '0',
          'content-type': 'application/json',
        },
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            try {
              const err = JSON.parse(body);
              reject(new Error(`APNs ${res.statusCode}: ${err.reason || body}`));
            } catch {
              reject(new Error(`APNs ${res.statusCode}: ${body}`));
            }
          }
        });
      });

      req.on('error', reject);
      req.write(JSON.stringify(apnsPayload));
      req.end();
    });
  }

  private getApnsJwt(keyId: string, teamId: string, keyContent: string): string {
    const now = Math.floor(Date.now() / 1000);

    // Reutilizar token si no expiró (válido 1 hora, renovar a los 50 min)
    if (this.apnsToken && this.apnsTokenExpiry > now) {
      return this.apnsToken;
    }

    // El key puede venir como string con \n escapados
    const key = keyContent.replace(/\\n/g, '\n');

    // Construir JWT manualmente con ES256
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: teamId, iat: now })).toString('base64url');
    const signInput = `${header}.${payload}`;

    const sign = crypto.createSign('SHA256');
    sign.update(signInput);
    const signature = sign.sign(key);

    // Convert DER signature to raw r||s format for ES256
    const r = signature.subarray(4, 4 + signature[3]);
    const sOffset = 4 + signature[3] + 2;
    const s = signature.subarray(sOffset);
    const rPadded = Buffer.alloc(32); r.copy(rPadded, 32 - r.length);
    const sPadded = Buffer.alloc(32); s.copy(sPadded, 32 - s.length);
    const rawSig = Buffer.concat([rPadded, sPadded]).toString('base64url');

    this.apnsToken = `${signInput}.${rawSig}`;
    this.apnsTokenExpiry = now + 3000; // renovar en 50 min
    return this.apnsToken!;
  }

  // ═══════════════════════════════════════════════════════════
  // LOGGING
  // ═══════════════════════════════════════════════════════════

  private async logPush(
    deviceTokenId: string, recipientType: string, recipientId: string,
    payload: PushPayload, status: string, errorMessage?: string,
  ) {
    try {
      await this.db.query(
        `INSERT INTO push_log (device_token_id, recipient_type, recipient_id, title, body, category, data, status, error_message)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [deviceTokenId, recipientType, recipientId, payload.title, payload.body,
         payload.category || null, payload.data ? JSON.stringify(payload.data) : null,
         status, errorMessage || null],
      );
    } catch (e) {
      this.logger.error(`Failed to log push: ${e.message}`);
    }
  }

  /** Stats de notificaciones enviadas */
  async getStats(recipientType?: string, recipientId?: string) {
    let query = `SELECT status, COUNT(*) AS count FROM push_log`;
    const params: any[] = [];
    if (recipientType && recipientId) {
      params.push(recipientType, recipientId);
      query += ` WHERE recipient_type = $1 AND recipient_id = $2`;
    }
    query += ` GROUP BY status`;
    return this.db.queryMany(query, params);
  }
}
