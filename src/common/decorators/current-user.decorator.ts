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
  (_: unknown, ctx: ExecutionContext): string => {
    const user = ctx.switchToHttp().getRequest().user as AuthUser;
    if (!user?.organizationId) {
      throw new ForbiddenException('Falta el header x-organization-id');
    }
    return user.organizationId;
  },
);
