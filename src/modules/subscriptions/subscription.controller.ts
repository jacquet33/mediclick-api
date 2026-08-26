import {
  Controller, Get, Post, Body, Req, HttpCode,
  HttpStatus, Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { Public, AdminOnly } from '../../common/guards/auth.guard';
import { SubscriptionService, VerifyReceiptDto } from './subscription.service';

@Controller('api/v1/subscriptions')
export class SubscriptionController {
  private readonly logger = new Logger(SubscriptionController.name);

  constructor(private subscriptionService: SubscriptionService) {}

  // ─── Estado actual ─────────────────────────────────────────

  /** GET /api/v1/subscriptions/me
   *  Obtener el estado de suscripción del doctor autenticado.
   *  La app llama esto al iniciar para saber si es Free o Pro. */
  @Get('me')
  async getMySubscription(@Req() req: Request) {
    return this.subscriptionService.getSubscription(req.user!.doctorId);
  }

  // ─── Compra / Verificación ─────────────────────────────────

  /** POST /api/v1/subscriptions/verify
   *  Verificar recibo de App Store / Play Store y activar Pro.
   *  Body: { store: 'apple'|'google', receipt: string, productId: string } */
  @Post('verify')
  async verifyReceipt(
    @Req() req: Request,
    @Body() dto: VerifyReceiptDto,
  ) {
    return this.subscriptionService.verifyAndActivate(req.user!.doctorId, dto);
  }

  /** POST /api/v1/subscriptions/restore
   *  Restaurar compras anteriores (botón "Restaurar compras" en la app).
   *  Mismo formato que verify. */
  @Post('restore')
  async restorePurchases(
    @Req() req: Request,
    @Body() dto: VerifyReceiptDto,
  ) {
    return this.subscriptionService.restorePurchases(req.user!.doctorId, dto);
  }

  // ─── Feature check ─────────────────────────────────────────

  /** GET /api/v1/subscriptions/check/:feature
   *  Verificar si el doctor puede usar una feature específica.
   *  Features: multi_org, express_appointment, conflict_detection,
   *            waitlist, smart_overbooking, unlimited_appointments */
  @Get('check/:feature')
  async checkFeature(
    @Req() req: Request,
  ) {
    const feature = req.params.feature as any;
    return this.subscriptionService.checkFeatureAccess(req.user!.doctorId, feature);
  }

  // ─── Webhooks (públicos, sin auth) ─────────────────────────

  /** POST /api/v1/subscriptions/webhooks/apple
   *  App Store Server Notifications V2 */
  @Public()
  @Post('webhooks/apple')
  @HttpCode(HttpStatus.OK)
  async appleWebhook(@Body() body: Record<string, unknown>) {
    try {
      await this.subscriptionService.handleAppleWebhook(body);
    } catch (err) {
      // Siempre responder 200 a Apple para evitar retries innecesarios
      this.logger.error('Error processing Apple webhook', err);
    }
    return { received: true };
  }

  /** POST /api/v1/subscriptions/webhooks/google
   *  Google Real-time Developer Notifications (RTDN) via Pub/Sub */
  @Public()
  @Post('webhooks/google')
  @HttpCode(HttpStatus.OK)
  async googleWebhook(@Body() body: Record<string, unknown>) {
    try {
      await this.subscriptionService.handleGoogleWebhook(body);
    } catch (err) {
      this.logger.error('Error processing Google webhook', err);
    }
    return { received: true };
  }

  // ─── Admin ─────────────────────────────────────────────────

  /** GET /api/v1/subscriptions/admin/metrics
   *  Métricas de suscripciones (solo admin de plataforma) */
  @AdminOnly()
  @Get('admin/metrics')
  async getMetrics() {
    return this.subscriptionService.getMetrics();
  }

  /** POST /api/v1/subscriptions/admin/grant
   *  Dar Pro manualmente a un doctor (solo admin) */
  @AdminOnly()
  @Post('admin/grant')
  async grantPro(
    @Body() body: { doctorId: string; months: number; reason: string },
  ) {
    await this.subscriptionService.grantProManual(
      body.doctorId, body.months, body.reason,
    );
    return { success: true, message: `Pro granted for ${body.months} months` };
  }
}
