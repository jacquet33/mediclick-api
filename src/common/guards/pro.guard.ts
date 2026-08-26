import {
  Injectable, CanActivate, ExecutionContext,
  ForbiddenException, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { DatabaseService } from '../../database/database.service';

// ─── Decoradores ────────────────────────────────────────────

/** Tipos de features que se pueden gatear */
export type ProFeature =
  | 'multi_org'
  | 'express_appointment'
  | 'conflict_detection'
  | 'waitlist'
  | 'smart_overbooking'
  | 'unlimited_appointments';

/** Marca una ruta como exclusiva del plan Pro */
export const REQUIRES_PRO = 'requiresPro';
export const RequiresPro = (feature?: ProFeature) =>
  SetMetadata(REQUIRES_PRO, feature || true);

// ─── Guard ──────────────────────────────────────────────────

@Injectable()
export class ProGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private db: DatabaseService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const requiresPro = this.reflector.getAllAndOverride<ProFeature | boolean>(
      REQUIRES_PRO,
      [ctx.getHandler(), ctx.getClass()],
    );

    // Si no tiene el decorador, pasa libre
    if (!requiresPro) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const doctorId = req.user?.doctorId;

    if (!doctorId) {
      throw new ForbiddenException('Autenticación requerida');
    }

    // Consultar plan actual del doctor
    const sub = await this.db.queryOne<{
      plan: string; is_pro: boolean;
      max_appointments_per_month: number;
      max_organizations: number;
    }>(
      'SELECT plan, is_pro, max_appointments_per_month, max_organizations FROM v_doctor_subscription WHERE doctor_id = $1',
      [doctorId],
    );

    const isPro = sub?.is_pro ?? false;

    if (isPro) return true;

    // Si es una feature específica, dar un mensaje claro
    const feature = typeof requiresPro === 'string' ? requiresPro : null;

    const featureNames: Record<string, string> = {
      multi_org: 'Multi-organización',
      express_appointment: 'Turno express',
      conflict_detection: 'Detección de conflictos',
      waitlist: 'Lista de espera',
      smart_overbooking: 'Sobreturnos inteligentes',
      unlimited_appointments: 'Turnos ilimitados',
    };

    const featureName = feature ? featureNames[feature] || feature : 'Esta funcionalidad';

    throw new ForbiddenException({
      error: 'PLAN_UPGRADE_REQUIRED',
      message: `${featureName} requiere el plan Pro ($2.99 USD/mes).`,
      feature: feature || 'pro',
      currentPlan: sub?.plan || 'free',
      upgradeUrl: 'mediclick://upgrade', // deep link para la app
    });
  }
}
