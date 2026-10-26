import {
  Controller, Get, Post, Body, Query, Req,
  HttpCode, HttpStatus, Logger, Param,
} from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../common/guards/auth.guard';
import { MercadoPagoService } from './mercadopago.service';
import { SubscribePlanDto } from '../../common/dto/misc.dto';

@Controller('api/v1/payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(private mpService: MercadoPagoService) {}

  // ─── Checkout ─────────────────────────────────────────────

  /** POST /api/v1/payments/subscribe
   *  Crea suscripción en Mercado Pago y devuelve URL de checkout.
   *  Body: { plan: 'pro' | 'centro' }
   *  Response: { checkoutUrl: string, subscriptionId: string } */
  @Post('subscribe')
  async subscribe(
    @Req() req: Request,
    @Body() dto: SubscribePlanDto,
  ) {
    return this.mpService.createSubscription(req.user!.doctorId, dto.plan as 'pro' | 'centro');
  }

  // ─── Cancelar ─────────────────────────────────────────────

  /** POST /api/v1/payments/cancel
   *  Cancela la suscripción de MP del doctor autenticado.
   *  La suscripción sigue activa hasta fin del período pagado. */
  @Post('cancel')
  async cancel(@Req() req: Request) {
    await this.mpService.cancelSubscription(req.user!.doctorId);
    return { success: true, message: 'Suscripción cancelada. Seguís teniendo acceso hasta fin del período.' };
  }

  // ─── Webhook de Mercado Pago (público) ────────────────────

  /** POST /api/v1/payments/webhooks/mercadopago
   *  Recibe notificaciones de Mercado Pago (IPN + Webhooks V2).
   *  Siempre responde 200 para que MP no reintente. */
  @Public()
  @Post('webhooks/mercadopago')
  @HttpCode(HttpStatus.OK)
  async mpWebhook(
    @Body() body: Record<string, unknown>,
    @Query() query: Record<string, string>,
  ) {
    try {
      await this.mpService.handleWebhook(body, query);
    } catch (err) {
      this.logger.error('Error processing MP webhook', err);
    }
    return { received: true };
  }

  // ─── Página de resultado ──────────────────────────────────

  /** GET /payment-result
   *  Página a la que MP redirige después del checkout.
   *  Muestra resultado al doctor. */
  @Public()
  @Get('/payment-result')
  paymentResult(
    @Query('status') status: string,
    @Query('external_reference') ref: string,
  ) {
    // En producción esto debería servir una página HTML bonita
    // o redirigir a la app con deep link
    return {
      status: status || 'unknown',
      message: status === 'approved'
        ? '¡Pago aprobado! Tu plan Pro ya está activo.'
        : status === 'pending'
          ? 'Tu pago está pendiente de acreditación.'
          : 'Hubo un problema con el pago. Intentá nuevamente.',
    };
  }
}
