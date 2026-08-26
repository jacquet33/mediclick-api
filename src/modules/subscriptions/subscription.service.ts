import {
  Injectable, Logger, BadRequestException,
  ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';

// ─── DTOs ──────────────────────────────────────────────────

export interface VerifyReceiptDto {
  store: 'apple' | 'google';
  receipt: string;            // Base64 receipt (Apple) o purchaseToken (Google)
  productId: string;          // com.mediclick.pro.monthly
  transactionId?: string;     // Para Apple
}

export interface SubscriptionInfo {
  plan: 'free' | 'pro';
  status: string;
  isPro: boolean;
  subscriptionId?: string;
  store?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelledAt?: string;
  gracePeriodEnd?: string;
  isTrial?: boolean;
  limits: {
    maxAppointmentsPerMonth: number;
    maxOrganizations: number;
  };
  usage?: {
    appointmentsThisMonth: number;
    organizationsCount: number;
  };
}

export interface StoreWebhookPayload {
  store: 'apple' | 'google';
  notificationType: string;
  data: Record<string, unknown>;
}

// ─── Apple types ───────────────────────────────────────────

interface AppleVerifyResponse {
  status: number;
  latest_receipt_info?: Array<{
    transaction_id: string;
    original_transaction_id: string;
    product_id: string;
    purchase_date_ms: string;
    expires_date_ms: string;
    is_trial_period: string;
    cancellation_date_ms?: string;
  }>;
  pending_renewal_info?: Array<{
    auto_renew_status: string;
    expiration_intent?: string;
  }>;
}

// ─── Constantes ────────────────────────────────────────────

const PRODUCT_ID_PRO_MONTHLY = 'com.mediclick.pro.monthly';
const FREE_LIMITS = {
  maxAppointmentsPerMonth: 50,
  maxOrganizations: 1,
};
const PRO_LIMITS = {
  maxAppointmentsPerMonth: -1, // ilimitado
  maxOrganizations: -1,
};

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private db: DatabaseService,
    private config: ConfigService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // CONSULTAR ESTADO
  // ═══════════════════════════════════════════════════════════

  /** Obtener info completa de suscripción del doctor */
  async getSubscription(doctorId: string): Promise<SubscriptionInfo> {
    const sub = await this.db.queryOne<{
      plan: string; subscription_status: string; is_pro: boolean;
      subscription_id: string; store: string;
      current_period_start: string; current_period_end: string;
      cancelled_at: string; grace_period_end: string;
      is_trial: boolean; max_appointments_per_month: number;
      max_organizations: number;
    }>(
      'SELECT * FROM v_doctor_subscription WHERE doctor_id = $1',
      [doctorId],
    );

    if (!sub) {
      // Doctor sin suscripción → free por defecto
      return {
        plan: 'free',
        status: 'active',
        isPro: false,
        limits: FREE_LIMITS,
      };
    }

    // Obtener uso actual
    const now = new Date();
    const usage = await this.db.queryOne<{
      appointments_count: number; organizations_count: number;
    }>(
      `SELECT
         COALESCE(appointments_count, 0) AS appointments_count,
         COALESCE(organizations_count, 0) AS organizations_count
       FROM feature_usage
       WHERE doctor_id = $1 AND period_year = $2 AND period_month = $3`,
      [doctorId, now.getFullYear(), now.getMonth() + 1],
    );

    const orgCount = await this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM organization_doctors
       WHERE doctor_id = $1 AND is_active = true`,
      [doctorId],
    );

    return {
      plan: sub.plan as 'free' | 'pro',
      status: sub.subscription_status,
      isPro: sub.is_pro,
      subscriptionId: sub.subscription_id,
      store: sub.store,
      currentPeriodStart: sub.current_period_start,
      currentPeriodEnd: sub.current_period_end,
      cancelledAt: sub.cancelled_at,
      gracePeriodEnd: sub.grace_period_end,
      isTrial: sub.is_trial,
      limits: sub.is_pro ? PRO_LIMITS : FREE_LIMITS,
      usage: {
        appointmentsThisMonth: usage?.appointments_count ?? 0,
        organizationsCount: orgCount?.count ?? 0,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // VERIFICAR RECIBOS (compra / renovación)
  // ═══════════════════════════════════════════════════════════

  /** Verificar recibo de App Store o Play Store y activar Pro */
  async verifyAndActivate(doctorId: string, dto: VerifyReceiptDto): Promise<SubscriptionInfo> {
    this.logger.log(`Verifying ${dto.store} receipt for doctor ${doctorId}`);

    let result: {
      transactionId: string;
      originalTransactionId: string;
      productId: string;
      purchaseDate: Date;
      expiresDate: Date;
      isTrial: boolean;
    };

    if (dto.store === 'apple') {
      result = await this.verifyAppleReceipt(dto);
    } else if (dto.store === 'google') {
      result = await this.verifyGoogleReceipt(dto);
    } else {
      throw new BadRequestException('Store no soportado');
    }

    // Activar o actualizar suscripción dentro de transacción
    await this.db.transaction(async (client) => {
      // Verificar si ya existe suscripción activa
      const existing = await client.query(
        `SELECT id, plan, status FROM subscriptions
         WHERE doctor_id = $1
           AND status IN ('active', 'grace_period', 'billing_retry')
         FOR UPDATE`,
        [doctorId],
      );

      if (existing.rows.length > 0) {
        const sub = existing.rows[0];
        // Actualizar suscripción existente
        await client.query(
          `UPDATE subscriptions SET
             plan = 'pro',
             status = 'active',
             store = $1,
             store_product_id = $2,
             store_transaction_id = $3,
             store_original_transaction_id = $4,
             current_period_start = $5,
             current_period_end = $6,
             price_usd = 2.99,
             is_trial = $7,
             raw_receipt = $8,
             last_verified_at = NOW(),
             cancelled_at = NULL,
             grace_period_end = NULL
           WHERE id = $9`,
          [
            dto.store, result.productId, result.transactionId,
            result.originalTransactionId, result.purchaseDate,
            result.expiresDate, result.isTrial,
            JSON.stringify({ receipt: dto.receipt.substring(0, 200) }),
            sub.id,
          ],
        );

        // Registrar evento
        await client.query(
          `INSERT INTO subscription_events
             (subscription_id, doctor_id, event_type, from_plan, to_plan,
              from_status, to_status, store, store_transaction_id, amount_usd)
           VALUES ($1, $2, $3, $4, 'pro', $5, 'active', $6, $7, 2.99)`,
          [
            sub.id, doctorId,
            sub.plan === 'free' ? 'subscribe' : 'renew',
            sub.plan, sub.status, dto.store, result.transactionId,
          ],
        );
      } else {
        // Crear nueva suscripción
        const newSub = await client.query(
          `INSERT INTO subscriptions
             (doctor_id, plan, status, store, store_product_id,
              store_transaction_id, store_original_transaction_id,
              current_period_start, current_period_end, price_usd,
              is_trial, raw_receipt, last_verified_at)
           VALUES ($1, 'pro', 'active', $2, $3, $4, $5, $6, $7, 2.99, $8, $9, NOW())
           RETURNING id`,
          [
            doctorId, dto.store, result.productId,
            result.transactionId, result.originalTransactionId,
            result.purchaseDate, result.expiresDate, result.isTrial,
            JSON.stringify({ receipt: dto.receipt.substring(0, 200) }),
          ],
        );

        await client.query(
          `INSERT INTO subscription_events
             (subscription_id, doctor_id, event_type, from_plan, to_plan,
              from_status, to_status, store, store_transaction_id, amount_usd)
           VALUES ($1, $2, 'subscribe', 'free', 'pro', NULL, 'active', $3, $4, 2.99)`,
          [newSub.rows[0].id, doctorId, dto.store, result.transactionId],
        );
      }
    });

    this.logger.log(`Doctor ${doctorId} upgraded to Pro via ${dto.store}`);
    return this.getSubscription(doctorId);
  }

  // ═══════════════════════════════════════════════════════════
  // WEBHOOKS (App Store Server Notifications V2 / Google RTDN)
  // ═══════════════════════════════════════════════════════════

  /** Procesar webhook de Apple (App Store Server Notifications V2) */
  async handleAppleWebhook(payload: Record<string, unknown>): Promise<void> {
    this.logger.log(`Apple webhook received: ${JSON.stringify(payload).substring(0, 200)}`);

    // En producción, verificar la firma JWS del signedPayload
    // Por ahora, extraer el tipo de notificación
    const notificationType = payload.notificationType as string;
    const data = payload.data as Record<string, unknown>;
    const signedTransactionInfo = data?.signedTransactionInfo as string;

    if (!signedTransactionInfo) {
      this.logger.warn('Apple webhook missing signedTransactionInfo');
      return;
    }

    // Decodificar JWS (en producción usar jose para verificar firma)
    // Por ahora parseamos el payload directamente
    const txnInfo = this.decodeJWSPayload(signedTransactionInfo);
    const originalTransactionId = txnInfo?.originalTransactionId as string;

    if (!originalTransactionId) return;

    const sub = await this.db.queryOne<{ id: string; doctor_id: string; plan: string; status: string }>(
      `SELECT id, doctor_id, plan, status FROM subscriptions
       WHERE store_original_transaction_id = $1`,
      [originalTransactionId],
    );

    if (!sub) {
      this.logger.warn(`No subscription found for Apple txn ${originalTransactionId}`);
      return;
    }

    switch (notificationType) {
      case 'DID_RENEW':
        await this.handleRenewal(sub, txnInfo);
        break;
      case 'DID_FAIL_TO_RENEW':
        await this.handleBillingRetry(sub);
        break;
      case 'DID_CHANGE_RENEWAL_STATUS':
        // El usuario canceló la renovación automática
        if (txnInfo.autoRenewStatus === 0) {
          await this.handleCancellation(sub, 'user_cancelled');
        }
        break;
      case 'EXPIRED':
        await this.handleExpiration(sub);
        break;
      case 'GRACE_PERIOD_EXPIRED':
        await this.handleExpiration(sub);
        break;
      case 'REFUND':
        await this.handleRefund(sub);
        break;
      default:
        this.logger.log(`Apple webhook type not handled: ${notificationType}`);
    }
  }

  /** Procesar webhook de Google (RTDN) */
  async handleGoogleWebhook(payload: Record<string, unknown>): Promise<void> {
    this.logger.log(`Google webhook received: ${JSON.stringify(payload).substring(0, 200)}`);

    const message = payload.message as Record<string, unknown>;
    if (!message?.data) return;

    const data = JSON.parse(
      Buffer.from(message.data as string, 'base64').toString(),
    ) as Record<string, unknown>;

    const subscriptionNotification = data.subscriptionNotification as Record<string, unknown>;
    if (!subscriptionNotification) return;

    const purchaseToken = subscriptionNotification.purchaseToken as string;
    const notificationType = subscriptionNotification.notificationType as number;

    const sub = await this.db.queryOne<{ id: string; doctor_id: string; plan: string; status: string }>(
      `SELECT id, doctor_id, plan, status FROM subscriptions
       WHERE store = 'google'
         AND raw_receipt->>'purchaseToken' = $1`,
      [purchaseToken],
    );

    if (!sub) {
      this.logger.warn(`No subscription found for Google purchaseToken`);
      return;
    }

    // Google RTDN notification types
    // 2 = RENEWED, 3 = CANCELLED, 5 = ON_HOLD, 6 = IN_GRACE_PERIOD,
    // 12 = REVOKED, 13 = EXPIRED
    switch (notificationType) {
      case 2: // RENEWED
        await this.handleRenewal(sub, { purchaseToken });
        break;
      case 3: // CANCELLED
        await this.handleCancellation(sub, 'user_cancelled');
        break;
      case 5: // ON_HOLD
        await this.handleBillingRetry(sub);
        break;
      case 6: // IN_GRACE_PERIOD
        await this.handleGracePeriod(sub);
        break;
      case 12: // REVOKED
        await this.handleRefund(sub);
        break;
      case 13: // EXPIRED
        await this.handleExpiration(sub);
        break;
      default:
        this.logger.log(`Google notification type not handled: ${notificationType}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // FEATURE GATING
  // ═══════════════════════════════════════════════════════════

  /** Verificar si el doctor puede usar una feature pro */
  async checkFeatureAccess(
    doctorId: string,
    feature: 'multi_org' | 'express_appointment' | 'conflict_detection' |
             'waitlist' | 'smart_overbooking' | 'unlimited_appointments',
  ): Promise<{ allowed: boolean; reason?: string }> {
    const sub = await this.getSubscription(doctorId);

    if (sub.isPro) return { allowed: true };

    switch (feature) {
      case 'multi_org':
        if ((sub.usage?.organizationsCount ?? 0) >= FREE_LIMITS.maxOrganizations) {
          return {
            allowed: false,
            reason: `El plan Free permite máximo ${FREE_LIMITS.maxOrganizations} organización. Upgrade a Pro para organizaciones ilimitadas.`,
          };
        }
        return { allowed: true };

      case 'unlimited_appointments':
        if ((sub.usage?.appointmentsThisMonth ?? 0) >= FREE_LIMITS.maxAppointmentsPerMonth) {
          return {
            allowed: false,
            reason: `Alcanzaste el límite de ${FREE_LIMITS.maxAppointmentsPerMonth} turnos/mes del plan Free. Upgrade a Pro para turnos ilimitados.`,
          };
        }
        return { allowed: true };

      case 'express_appointment':
      case 'conflict_detection':
      case 'waitlist':
      case 'smart_overbooking':
        return {
          allowed: false,
          reason: `Esta funcionalidad requiere el plan Pro ($2.99 USD/mes).`,
        };

      default:
        return { allowed: true };
    }
  }

  /** Incrementar contador de uso mensual */
  async incrementUsage(
    doctorId: string,
    field: 'appointments_count' | 'organizations_count',
  ): Promise<void> {
    const now = new Date();
    await this.db.query(
      `INSERT INTO feature_usage (doctor_id, period_year, period_month, ${field})
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (doctor_id, period_year, period_month)
       DO UPDATE SET ${field} = feature_usage.${field} + 1, updated_at = NOW()`,
      [doctorId, now.getFullYear(), now.getMonth() + 1],
    );
  }

  // ═══════════════════════════════════════════════════════════
  // RESTORE PURCHASES
  // ═══════════════════════════════════════════════════════════

  /** Restaurar compras (para el botón "Restore Purchases" en la app) */
  async restorePurchases(doctorId: string, dto: VerifyReceiptDto): Promise<SubscriptionInfo> {
    // Mismo flujo que verifyAndActivate
    return this.verifyAndActivate(doctorId, dto);
  }

  // ═══════════════════════════════════════════════════════════
  // ADMIN / ANALYTICS
  // ═══════════════════════════════════════════════════════════

  /** Obtener métricas de suscripciones (solo admin) */
  async getMetrics(): Promise<Record<string, unknown>> {
    const totals = await this.db.queryOne(`
      SELECT
        COUNT(*) FILTER (WHERE plan = 'free')::int AS free_count,
        COUNT(*) FILTER (WHERE plan = 'pro' AND status = 'active')::int AS pro_active,
        COUNT(*) FILTER (WHERE plan = 'pro' AND status = 'cancelled')::int AS pro_cancelled,
        COUNT(*) FILTER (WHERE plan = 'pro' AND status = 'expired')::int AS pro_expired,
        COALESCE(SUM(price_usd) FILTER (WHERE plan = 'pro' AND status = 'active'), 0) AS mrr_usd
      FROM subscriptions
    `);

    const recentEvents = await this.db.queryMany(`
      SELECT event_type, COUNT(*)::int AS count
      FROM subscription_events
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY event_type ORDER BY count DESC
    `);

    return {
      ...totals,
      recentEvents,
    };
  }

  /** Dar Pro manualmente a un doctor (admin) */
  async grantProManual(doctorId: string, months: number, reason: string): Promise<void> {
    const start = new Date();
    const end = new Date(start);
    end.setMonth(end.getMonth() + months);

    await this.db.transaction(async (client) => {
      // Desactivar suscripción anterior
      await client.query(
        `UPDATE subscriptions SET status = 'expired'
         WHERE doctor_id = $1 AND status IN ('active', 'grace_period')`,
        [doctorId],
      );

      const sub = await client.query(
        `INSERT INTO subscriptions
           (doctor_id, plan, status, store, current_period_start, current_period_end, price_usd)
         VALUES ($1, 'pro', 'active', 'manual', $2, $3, 0)
         RETURNING id`,
        [doctorId, start, end],
      );

      await client.query(
        `INSERT INTO subscription_events
           (subscription_id, doctor_id, event_type, from_plan, to_plan,
            from_status, to_status, store, amount_usd, reason)
         VALUES ($1, $2, 'upgrade', 'free', 'pro', NULL, 'active', 'manual', 0, $3)`,
        [sub.rows[0].id, doctorId, reason],
      );
    });

    this.logger.log(`Admin granted Pro to doctor ${doctorId} for ${months} months: ${reason}`);
  }

  // ═══════════════════════════════════════════════════════════
  // HELPERS PRIVADOS
  // ═══════════════════════════════════════════════════════════

  /** Verificar recibo con Apple */
  private async verifyAppleReceipt(dto: VerifyReceiptDto) {
    // En producción: usar App Store Server API v2 (JWT-based)
    // https://developer.apple.com/documentation/appstoreserverapi
    //
    // Para sandbox/dev, usar el endpoint de verificación legacy:
    // Sandbox: https://sandbox.itunes.apple.com/verifyReceipt
    // Production: https://buy.itunes.apple.com/verifyReceipt

    const isProduction = this.config.get('NODE_ENV') === 'production';
    const verifyUrl = isProduction
      ? 'https://buy.itunes.apple.com/verifyReceipt'
      : 'https://sandbox.itunes.apple.com/verifyReceipt';

    const sharedSecret = this.config.get<string>('APPLE_SHARED_SECRET');

    try {
      const response = await fetch(verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          'receipt-data': dto.receipt,
          password: sharedSecret,
          'exclude-old-transactions': true,
        }),
      });

      const data = (await response.json()) as AppleVerifyResponse;

      // Status 21007 = sandbox receipt sent to production → retry sandbox
      if (data.status === 21007) {
        const sandboxResponse = await fetch(
          'https://sandbox.itunes.apple.com/verifyReceipt',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              'receipt-data': dto.receipt,
              password: sharedSecret,
              'exclude-old-transactions': true,
            }),
          },
        );
        const sandboxData = (await sandboxResponse.json()) as AppleVerifyResponse;
        return this.parseAppleReceipt(sandboxData);
      }

      if (data.status !== 0) {
        throw new BadRequestException(`Apple receipt verification failed: status ${data.status}`);
      }

      return this.parseAppleReceipt(data);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Apple receipt verification error`, err);
      throw new BadRequestException('No se pudo verificar el recibo de Apple');
    }
  }

  private parseAppleReceipt(data: AppleVerifyResponse) {
    const latestReceipt = data.latest_receipt_info
      ?.filter((r) => r.product_id === PRODUCT_ID_PRO_MONTHLY)
      .sort((a, b) => Number(b.expires_date_ms) - Number(a.expires_date_ms))[0];

    if (!latestReceipt) {
      throw new BadRequestException('No se encontró suscripción Pro en el recibo');
    }

    return {
      transactionId: latestReceipt.transaction_id,
      originalTransactionId: latestReceipt.original_transaction_id,
      productId: latestReceipt.product_id,
      purchaseDate: new Date(Number(latestReceipt.purchase_date_ms)),
      expiresDate: new Date(Number(latestReceipt.expires_date_ms)),
      isTrial: latestReceipt.is_trial_period === 'true',
    };
  }

  /** Verificar recibo con Google Play */
  private async verifyGoogleReceipt(dto: VerifyReceiptDto) {
    // En producción: usar Google Play Developer API
    // GET https://androidpublisher.googleapis.com/androidpublisher/v3/
    //     applications/{packageName}/purchases/subscriptions/{subscriptionId}/tokens/{token}
    //
    // Requiere Service Account con permisos en Google Play Console

    const packageName = this.config.get<string>('GOOGLE_PACKAGE_NAME') || 'com.mediclick.app';
    const serviceAccountKey = this.config.get<string>('GOOGLE_SERVICE_ACCOUNT_KEY');

    try {
      // Obtener access token con service account
      const accessToken = await this.getGoogleAccessToken(serviceAccountKey);

      const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptionsv2/tokens/${dto.receipt}`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        const errBody = await response.text();
        this.logger.error(`Google verification failed: ${errBody}`);
        throw new BadRequestException('No se pudo verificar el recibo de Google');
      }

      const data = (await response.json()) as Record<string, unknown>;
      const lineItems = data.lineItems as Array<{ productId: string; expiryTime: string }>;
      const item = lineItems?.[0];

      if (!item) {
        throw new BadRequestException('No se encontró suscripción en el recibo de Google');
      }

      return {
        transactionId: dto.receipt.substring(0, 200), // purchaseToken as txn ID
        originalTransactionId: (data.linkedPurchaseToken as string) || dto.receipt.substring(0, 200),
        productId: item.productId,
        purchaseDate: new Date(data.startTime as string),
        expiresDate: new Date(item.expiryTime),
        isTrial: false,
      };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Google receipt verification error`, err);
      throw new BadRequestException('No se pudo verificar el recibo de Google');
    }
  }

  /** Obtener access token de Google con service account (JWT) */
  private async getGoogleAccessToken(serviceAccountKey: string | undefined): Promise<string> {
    if (!serviceAccountKey) {
      throw new BadRequestException('Google Service Account no configurado');
    }

    // En producción, usar google-auth-library o generar JWT manualmente
    // Por ahora, placeholder que se debe reemplazar con la implementación real
    // usando la clave privada del service account para firmar un JWT
    // y canjearlo por un access token en https://oauth2.googleapis.com/token
    this.logger.warn('Google access token generation needs production implementation');
    return 'placeholder_access_token';
  }

  // ─── Webhook handlers ──────────────────────────────────────

  private async handleRenewal(
    sub: { id: string; doctor_id: string; plan: string; status: string },
    txnInfo: Record<string, unknown>,
  ): Promise<void> {
    const expiresDate = txnInfo.expiresDate
      ? new Date(txnInfo.expiresDate as string)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30 días

    await this.db.query(
      `UPDATE subscriptions SET
         status = 'active', current_period_end = $1, last_verified_at = NOW()
       WHERE id = $2`,
      [expiresDate, sub.id],
    );

    await this.logEvent(sub.id, sub.doctor_id, 'renew', sub.plan, 'pro', sub.status, 'active');
    this.logger.log(`Subscription renewed for doctor ${sub.doctor_id}`);
  }

  private async handleCancellation(
    sub: { id: string; doctor_id: string; plan: string; status: string },
    reason: string,
  ): Promise<void> {
    // No expira inmediatamente, sigue activo hasta current_period_end
    await this.db.query(
      `UPDATE subscriptions SET cancelled_at = NOW() WHERE id = $1`,
      [sub.id],
    );

    await this.logEvent(sub.id, sub.doctor_id, 'cancel', sub.plan, sub.plan, sub.status, sub.status, reason);
    this.logger.log(`Subscription cancellation scheduled for doctor ${sub.doctor_id}`);
  }

  private async handleBillingRetry(
    sub: { id: string; doctor_id: string; plan: string; status: string },
  ): Promise<void> {
    await this.db.query(
      `UPDATE subscriptions SET status = 'billing_retry' WHERE id = $1`,
      [sub.id],
    );

    await this.logEvent(sub.id, sub.doctor_id, 'billing_retry', sub.plan, sub.plan, sub.status, 'billing_retry');
    this.logger.log(`Billing retry for doctor ${sub.doctor_id}`);
  }

  private async handleGracePeriod(
    sub: { id: string; doctor_id: string; plan: string; status: string },
  ): Promise<void> {
    const gracePeriodEnd = new Date(Date.now() + 16 * 24 * 60 * 60 * 1000); // +16 días

    await this.db.query(
      `UPDATE subscriptions SET status = 'grace_period', grace_period_end = $1 WHERE id = $2`,
      [gracePeriodEnd, sub.id],
    );

    await this.logEvent(sub.id, sub.doctor_id, 'grace_period', sub.plan, sub.plan, sub.status, 'grace_period');
    this.logger.log(`Grace period started for doctor ${sub.doctor_id}`);
  }

  private async handleExpiration(
    sub: { id: string; doctor_id: string; plan: string; status: string },
  ): Promise<void> {
    await this.db.query(
      `UPDATE subscriptions SET status = 'expired', plan = 'free' WHERE id = $1`,
      [sub.id],
    );

    await this.logEvent(sub.id, sub.doctor_id, 'expire', sub.plan, 'free', sub.status, 'expired');
    this.logger.log(`Subscription expired for doctor ${sub.doctor_id}`);
  }

  private async handleRefund(
    sub: { id: string; doctor_id: string; plan: string; status: string },
  ): Promise<void> {
    await this.db.query(
      `UPDATE subscriptions SET status = 'expired', plan = 'free' WHERE id = $1`,
      [sub.id],
    );

    await this.logEvent(sub.id, sub.doctor_id, 'refund', sub.plan, 'free', sub.status, 'expired', 'refund');
    this.logger.log(`Subscription refunded for doctor ${sub.doctor_id}`);
  }

  private async logEvent(
    subscriptionId: string, doctorId: string,
    eventType: string, fromPlan: string, toPlan: string,
    fromStatus: string, toStatus: string, reason?: string,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO subscription_events
         (subscription_id, doctor_id, event_type, from_plan, to_plan,
          from_status, to_status, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [subscriptionId, doctorId, eventType, fromPlan, toPlan, fromStatus, toStatus, reason],
    );
  }

  /** Decodificar payload de un JWS (sin verificar firma — solo para extraer datos) */
  private decodeJWSPayload(jws: string): Record<string, unknown> | null {
    try {
      const parts = jws.split('.');
      if (parts.length !== 3) return null;
      const payload = Buffer.from(parts[1], 'base64url').toString();
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
}
