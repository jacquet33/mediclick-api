import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser, Public } from '../../common/guards/auth.guard';
import { MercadoPagoService } from '../payments/mercadopago.service';
import { PLANES, PlanesService } from './planes.service';

/** Plan del médico: GET /planes/mio · POST /planes/mejorar · POST /planes/cancelar · GET /public/planes */
@Controller('api/v1')
export class PlanesController {
  constructor(private planes: PlanesService, private mp: MercadoPagoService, private config: ConfigService) {}
  private medico(u: AuthUser) {
    if (u.userType !== 'doctor' || !u.doctorId) throw new ForbiddenException('El plan lo administra el médico titular');
    return u.doctorId;
  }

  @Public()
  @Get('public/planes')
  publicos() {
    return { planes: Object.entries(PLANES).map(([id, p]) => ({ id, nombre: p.nombre, precio: p.precio, waAutoMes: p.waAutoMes, profesionales: p.profesionales })), promoHasta: this.planes.promoHasta };
  }

  @Get('planes/mio')
  mio(@CurrentUser() u: AuthUser) { return this.planes.estado(this.medico(u)); }

  /** Inicia el pago mensual en Mercado Pago y devuelve el link de checkout */
  @Post('planes/mejorar')
  async mejorar(@CurrentUser() u: AuthUser, @Body() b: { plan?: string }) {
    const doctorId = this.medico(u);
    const plan = (['profesional', 'consultorio', 'clinica'] as const).find((x) => x === b?.plan) || null;
    if (!plan) throw new BadRequestException('Elegí un plan');
    if (!this.config.get('MP_ACCESS_TOKEN')) {
      throw new ServiceUnavailableException('El pago online se habilita en breve. Mientras tanto escribinos a support@tusrecetasmed.com y te activamos el plan.');
    }
    const r = await this.mp.createSubscription(doctorId, PLANES[plan].mpPlan as 'pro' | 'centro' | 'clinica');
    return { checkoutUrl: r.checkoutUrl };
  }

  @Post('planes/cancelar')
  async cancelar(@CurrentUser() u: AuthUser) {
    await this.mp.cancelSubscription(this.medico(u));
    return { ok: true, mensaje: 'Cancelaste la renovación. Seguís con el plan hasta el final del período pagado.' };
  }
}
