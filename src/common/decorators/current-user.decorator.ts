import { createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthUser } from '../guards/auth.guard';

/**
 * Identidad verificada del token.
 *
 * Reemplaza a @Headers('x-doctor-id') — la diferencia es que este
 * valor viene de un JWT firmado, no de algo que el cliente escribe.
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const user = ctx.switchToHttp().getRequest().user as AuthUser;
    return field ? user?.[field] : user;
  },
);

/** El id del doctor autenticado */
export const DoctorId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const user = ctx.switchToHttp().getRequest().user as AuthUser;
    if (!user?.doctorId) throw new ForbiddenException('Sin identidad');
    return user.doctorId;
  },
);

/**
 * El id de la organización activa, ya verificada contra
 * organization_doctors por el guard.
 */
export const OrgId = createParamDecorator(
  async (_: unknown, ctx: ExecutionContext): Promise<string> => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthUser;
    
    // Si tiene orgId válido, usarlo
    if (user?.organizationId && user.organizationId.length > 10) {
      return user.organizationId;
    }
    
    // Fallback: buscar la primera org del doctor desde el JWT
    if (user?.doctorId) {
      try {
        const { DatabaseService } = require('../../database/database.service');
        const db = request.app?.get?.(DatabaseService);
        if (db) {
          const org = await db.queryOne(
            'SELECT organization_id FROM organization_doctors WHERE doctor_id = $1 AND is_active = true LIMIT 1',
            [user.doctorId],
          );
          if (org?.organization_id) return org.organization_id;
        }
      } catch {}
    }
    
    throw new ForbiddenException('Falta el header x-organization-id');
  },
);
