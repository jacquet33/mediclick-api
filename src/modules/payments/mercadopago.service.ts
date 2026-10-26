import {
  Injectable, Logger, BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';

/**
 * Servicio de integración con Mercado Pago.
 *
 * Usa la API de Preapproval (suscripciones recurrentes) de Mercado Pago.
 * Docs: https://www.mercadopago.com.ar/developers/es/reference/subscriptions/_preapproval/post
 *
 * Variables de entorno requeridas:
 *   MP_ACCESS_TOKEN      — Access token de producción
 *   MP_PUBLIC_KEY        — Public key (para frontend checkout)
 *   MP_WEBHOOK_SECRET    — Secret para validar webhooks (opcional)
 *   MP_NOTIFICATION_URL  — URL pública para webhooks (ej: https://mediclick.art3d-studio.com.ar/api/v1/payments/webhooks/mercadopago)
 */

interface MpPreapproval {
  id: string;
  status: string;
  init_point: string;
  payer_id: number;
  external_reference: string;
  date_created: string;
  last_modified: string;
  preapproval_plan_id?: string;
  auto_recurring: {
    frequency: number;
    frequency_type: string;
    transaction_amount: number;
    currency_id: string;
  };
}

@Injectable()
export class MercadoPagoService {
  private readonly logger = new Logger(MercadoPagoService.name);
  private readonly apiBase = 'https://api.mercadopago.com';

  constructor(
    private db: DatabaseService,
    private config: ConfigService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // CREAR SUSCRIPCIÓN
  // ═══════════════════════════════════════════════════════════

  /**
   * Crea una suscripción de Mercado Pago y devuelve la URL de pago.
   * El doctor es redirigido a Mercado Pago para completar el pago.
   */
  async createSubscription(
    doctorId: string,
    planType: 'pro' | 'centro',
  ): Promise<{ checkoutUrl: string; subscriptionId: string }> {
    const accessToken = this.getAccessToken();

    // Obtener datos del plan
    const plan = await this.db.queryOne<{
      id: string; name: string; description: string;
      amount: number; currency: string;
    }>(
      `SELECT id, name, description, amount, currency
       FROM mp_plans WHERE internal_plan = $1 AND is_active = true`,
      [planType],
    );

    if (!plan) {
      throw new BadRequestException(`Plan "${planType}" no disponible`);
    }

    // Obtener datos del doctor
    const doctor = await this.db.queryOne<{
      email: string; first_name: string; last_name: string;
    }>(
      `SELECT email, first_name, last_name FROM doctors WHERE id = $1`,
      [doctorId],
    );

    if (!doctor) {
      throw new BadRequestException('Doctor no encontrado');
    }

    const notificationUrl = this.config.get('MP_NOTIFICATION_URL')
      || `${this.config.get('API_BASE_URL') || 'https://mediclick.art3d-studio.com.ar'}/api/v1/payments/webhooks/mercadopago`;

    // Crear preapproval (suscripción) en Mercado Pago
    const body = {
      reason: plan.name,
      external_reference: `${doctorId}|${planType}`,
      payer_email: doctor.email,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: plan.amount,
        currency_id: plan.currency,
      },
      back_url: `${this.config.get('API_BASE_URL') || 'https://mediclick.art3d-studio.com.ar'}/payment-result`,
      notification_url: notificationUrl,
    };

    try {
      const response = await fetch(`${this.apiBase}/preapproval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errBody = await response.text();
        this.logger.error(`MP create subscription failed: ${response.status} ${errBody}`);
        throw new InternalServerErrorException('Error al crear suscripción en Mercado Pago');
      }

      const mpSub = (await response.json()) as MpPreapproval;

      // Guardar/actualizar suscripción en nuestra DB
      await this.db.transaction(async (client) => {
        // Desactivar suscripción anterior si existe
        await client.query(
          `UPDATE subscriptions SET status = 'expired'
           WHERE doctor_id = $1 AND store = 'mercadopago'
             AND status IN ('active', 'grace_period')`,
          [doctorId],
        );

        // Crear nueva suscripción (pendiente hasta que MP confirme)
        const sub = await client.query(
          `INSERT INTO subscriptions
             (doctor_id, plan, status, store, store_product_id,
              store_transaction_id, price_usd, currency,
              current_period_start, raw_receipt)
           VALUES ($1, $2, 'active', 'mercadopago', $3, $4, $5, 'ARS', NOW(),
                   $6::jsonb)
           RETURNING id`,
          [
            doctorId,
            planType === 'centro' ? 'pro' : 'pro', // ambos dan Pro
            planType,
            mpSub.id,
            plan.amount,
            JSON.stringify({ mp_preapproval_id: mpSub.id, init_point: mpSub.init_point }),
          ],
        );

        // Registrar evento
        await client.query(
          `INSERT INTO subscription_events
             (subscription_id, doctor_id, event_type, from_plan, to_plan,
              from_status, to_status, store, amount_usd, reason)
           VALUES ($1, $2, 'subscribe', 'free', 'pro', NULL, 'active',
                   'mercadopago', $3, 'Mercado Pago checkout')`,
          [sub.rows[0].id, doctorId, plan.amount],
        );
      });

      this.logger.log(`MP subscription created for doctor ${doctorId}: ${mpSub.id}`);

      return {
        checkoutUrl: mpSub.init_point,
        subscriptionId: mpSub.id,
      };
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof InternalServerErrorException) throw err;
      this.logger.error('MP create subscription error', err);
      throw new InternalServerErrorException('Error al conectar con Mercado Pago');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // WEBHOOK
  // ═══════════════════════════════════════════════════════════

  /**
   * Procesa notificaciones webhook de Mercado Pago.
   * MP envía notificaciones tipo IPN o Webhooks V2.
   */
  async handleWebhook(body: Record<string, unknown>, query: Record<string, string>): Promise<void> {
    // Mercado Pago puede enviar notificaciones por query params (IPN) o body (Webhooks)
    const topic = (query.topic || body.type) as string;
    const resourceId = (query.id || body.data && (body.data as any).id) as string;

    this.logger.log(`MP webhook: topic=${topic}, id=${resourceId}`);

    if (!topic || !resourceId) {
      this.logger.warn('MP webhook missing topic or id');
      return;
    }

    switch (topic) {
      case 'payment':
        await this.handlePaymentNotification(resourceId);
        break;
      case 'subscription_preapproval':
      case 'preapproval':
        await this.handlePreapprovalNotification(resourceId);
        break;
      default:
        this.logger.log(`MP webhook topic not handled: ${topic}`);
    }
  }

  /**
   * Maneja notificación de pago (payment).
   * Consulta el estado del pago en la API de MP.
   */
  private async handlePaymentNotification(paymentId: string): Promise<void> {
    const accessToken = this.getAccessToken();

    try {
      const response = await fetch(`${this.apiBase}/v1/payments/${paymentId}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        this.logger.error(`MP get payment failed: ${response.status}`);
        return;
      }

      const payment = (await response.json()) as Record<string, unknown>;
      const status = payment.status as string;
      const externalRef = payment.external_reference as string;
      const preapprovalId = (payment.metadata as Record<string, unknown>)?.preapproval_id as string;

      if (!externalRef) {
        this.logger.warn('MP payment without external_reference');
        return;
      }

      // external_reference = "doctorId|planType"
      const [doctorId] = externalRef.split('|');

      // Buscar suscripción del doctor
      const sub = await this.db.queryOne<{ id: string; status: string }>(
        `SELECT id, status FROM subscriptions
         WHERE doctor_id = $1 AND store = 'mercadopago'
           AND status IN ('active', 'grace_period', 'billing_retry')
         ORDER BY created_at DESC LIMIT 1`,
        [doctorId],
      );

      if (!sub) {
        this.logger.warn(`No MP subscription found for doctor ${doctorId}`);
        return;
      }

      // Guardar registro de pago
      await this.db.query(
        `INSERT INTO mp_payments
           (subscription_id, doctor_id, mp_payment_id, mp_preapproval_id,
            mp_status, mp_status_detail, amount, currency,
            date_approved, date_created, raw_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
         ON CONFLICT (mp_payment_id) DO UPDATE SET
           mp_status = EXCLUDED.mp_status,
           mp_status_detail = EXCLUDED.mp_status_detail,
           raw_data = EXCLUDED.raw_data`,
        [
          sub.id, doctorId, paymentId, preapprovalId || null,
          status, payment.status_detail as string || null,
          payment.transaction_amount as number || 0,
          payment.currency_id as string || 'ARS',
          payment.date_approved || null,
          payment.date_created || null,
          JSON.stringify(payment),
        ],
      );

      // Actualizar estado de suscripción según estado del pago
      if (status === 'approved') {
        const periodEnd = new Date();
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        await this.db.query(
          `UPDATE subscriptions SET
             status = 'active', plan = 'pro',
             current_period_start = NOW(),
             current_period_end = $1,
             last_verified_at = NOW()
           WHERE id = $2`,
          [periodEnd, sub.id],
        );

        this.logger.log(`MP payment approved: doctor ${doctorId} is Pro`);
      } else if (status === 'rejected') {
        await this.db.query(
          `UPDATE subscriptions SET status = 'billing_retry' WHERE id = $1`,
          [sub.id],
        );
        this.logger.warn(`MP payment rejected for doctor ${doctorId}`);
      }
    } catch (err) {
      this.logger.error(`MP payment notification error for ${paymentId}`, err);
    }
  }

  /**
   * Maneja notificación de cambio en la suscripción (preapproval).
   */
  private async handlePreapprovalNotification(preapprovalId: string): Promise<void> {
    const accessToken = this.getAccessToken();

    try {
      const response = await fetch(`${this.apiBase}/preapproval/${preapprovalId}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        this.logger.error(`MP get preapproval failed: ${response.status}`);
        return;
      }

      const preapproval = (await response.json()) as MpPreapproval;
      const externalRef = preapproval.external_reference;

      if (!externalRef) return;

      const [doctorId] = externalRef.split('|');

      const sub = await this.db.queryOne<{ id: string; status: string; plan: string }>(
        `SELECT id, status, plan FROM subscriptions
         WHERE store_transaction_id = $1 OR
               (doctor_id = $2 AND store = 'mercadopago'
                AND status IN ('active', 'grace_period', 'billing_retry'))
         ORDER BY created_at DESC LIMIT 1`,
        [preapprovalId, doctorId],
      );

      if (!sub) return;

      // Mapear estados de MP a nuestro modelo
      switch (preapproval.status) {
        case 'authorized':
        case 'active':
          // no-op: los pagos individuales actualizan el estado
          break;
        case 'paused':
          await this.db.query(
            `UPDATE subscriptions SET status = 'billing_retry' WHERE id = $1`,
            [sub.id],
          );
          break;
        case 'cancelled':
          await this.db.query(
            `UPDATE subscriptions SET cancelled_at = NOW() WHERE id = $1`,
            [sub.id],
          );
          await this.logEvent(sub.id, doctorId, 'cancel', sub.plan, sub.plan, sub.status, sub.status, 'MP cancelled');
          break;
      }

      this.logger.log(`MP preapproval ${preapprovalId} status: ${preapproval.status}`);
    } catch (err) {
      this.logger.error(`MP preapproval notification error for ${preapprovalId}`, err);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CANCELAR SUSCRIPCIÓN
  // ═══════════════════════════════════════════════════════════

  async cancelSubscription(doctorId: string): Promise<void> {
    const sub = await this.db.queryOne<{
      id: string; store_transaction_id: string; status: string; plan: string;
    }>(
      `SELECT id, store_transaction_id, status, plan FROM subscriptions
       WHERE doctor_id = $1 AND store = 'mercadopago'
         AND status IN ('active', 'grace_period')
       ORDER BY created_at DESC LIMIT 1`,
      [doctorId],
    );

    if (!sub) {
      throw new BadRequestException('No tenés una suscripción activa de Mercado Pago');
    }

    const accessToken = this.getAccessToken();

    // Cancelar en MP
    try {
      const response = await fetch(`${this.apiBase}/preapproval/${sub.store_transaction_id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ status: 'cancelled' }),
      });

      if (!response.ok) {
        this.logger.error(`MP cancel failed: ${response.status}`);
      }
    } catch (err) {
      this.logger.error('MP cancel error', err);
    }

    // Marcar como cancelada localmente (sigue activa hasta fin del período)
    await this.db.query(
      `UPDATE subscriptions SET cancelled_at = NOW() WHERE id = $1`,
      [sub.id],
    );

    await this.logEvent(sub.id, doctorId, 'cancel', sub.plan, sub.plan, sub.status, sub.status, 'user_cancelled_mp');
    this.logger.log(`MP subscription cancelled for doctor ${doctorId}`);
  }

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════

  private getAccessToken(): string {
    const token = this.config.get<string>('MP_ACCESS_TOKEN');
    if (!token) {
      throw new InternalServerErrorException('Mercado Pago no está configurado (MP_ACCESS_TOKEN)');
    }
    return token;
  }

  private async logEvent(
    subscriptionId: string, doctorId: string,
    eventType: string, fromPlan: string, toPlan: string,
    fromStatus: string, toStatus: string, reason?: string,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO subscription_events
         (subscription_id, doctor_id, event_type, from_plan, to_plan,
          from_status, to_status, store, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'mercadopago', $8)`,
      [subscriptionId, doctorId, eventType, fromPlan, toPlan, fromStatus, toStatus, reason],
    );
  }
}
