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
    return { planes: Object.entries(PLANES).filter(([id]) => id !== 'gratis').map(([id, p]) => ({ id, nombre: p.nombre, precio: p.precio, waAutoMes: p.waAutoMes, profesionales: p.profesionales })), diasPrueba: PlanesService.DIAS_PRUEBA };
  }

  @Get('planes/mio')
  mio(@CurrentUser() u: AuthUser) { return this.planes.estado(this.medico(u)); }

  /**
   * GET /app/acceso — ¿puede usar la app móvil? Las apps son solo para cuentas con plan pago
   * (el alta y el pago se hacen en la web). Secretarías: si algún profesional del consultorio paga.
   */
  @Get('app/acceso')
  async accesoApp(@CurrentUser() u: AuthUser) {
    const no = { permitido: false, motivo: 'Tu cuenta no tiene un plan activo. Para usar la app, activá tu plan desde la web de TusRecetasMed. Después volvé a abrir la app.' };
    if (u.isPlatformAdmin) return { permitido: true };
    if (u.userType === 'doctor' && u.doctorId) {
      const e = await this.planes.estado(u.doctorId);
      return e.origen === 'pago' ? { permitido: true, plan: e.plan } : no;
    }
    if (u.userType === 'staff' && u.organizationId) {
      for (const d of await this.planes.doctoresDeOrganizacion(u.organizationId)) {
        if ((await this.planes.estado(d)).origen === 'pago') return { permitido: true };
      }
      return { ...no, motivo: 'El consultorio no tiene un plan activo. Pedile al profesional titular que lo active desde la web de TusRecetasMed.' };
    }
    return { permitido: false, motivo: 'La app de TusRecetasMed es para profesionales de la salud.' };
  }

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
