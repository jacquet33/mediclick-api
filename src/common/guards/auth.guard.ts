import {
  Injectable, CanActivate, ExecutionContext,
  UnauthorizedException, ForbiddenException, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { DatabaseService } from '../../database/database.service';

/** Marca una ruta como pública (sin token) */
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Marca una ruta como solo para staff de TuConsultorioOnline */
export const IS_ADMIN = 'isAdmin';
export const AdminOnly = () => SetMetadata(IS_ADMIN, true);

/** Identidad verificada, derivada del token — nunca de headers */
export interface AuthUser {
  doctorId: string;       // ID del usuario (doctor, paciente o staff)
  userType: string;       // 'doctor' | 'patient' | 'staff'
  email: string;
  organizationId?: string;
  orgRole?: string;
  isPlatformAdmin: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwt: JwtService,
    private config: ConfigService,
    private db: DatabaseService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Falta el token de acceso');

    // 1. Verificar firma y expiración
    let payload: { sub: string; email: string; userType?: string };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Token inválido o vencido');
    }

    const userType = payload.userType || 'doctor';

    // 2. Buscar usuario en la tabla correspondiente
    let userRecord: { id: string; email: string; is_active: boolean; is_platform_admin: boolean } | null = null;

    if (userType === 'patient') {
      const patient = await this.db.queryOne<{
        id: string; email: string; is_active: boolean;
      }>(
        `SELECT id, email, COALESCE(is_active, true) AS is_active FROM patient_auth WHERE id = $1`,
        [payload.sub],
      );
      if (patient) {
        userRecord = { ...patient, is_platform_admin: false };
      }
    } else if (userType === 'staff') {
      const staff = await this.db.queryOne<{
        id: string; email: string; is_active: boolean;
      }>(
        `SELECT id, email, COALESCE(is_active, true) AS is_active FROM staff WHERE id = $1`,
        [payload.sub],
      );
      if (staff) {
        userRecord = { ...staff, is_platform_admin: false };
      }
    } else {
      // doctor (default)
      userRecord = await this.db.queryOne<{
        id: string; email: string; is_active: boolean; is_platform_admin: boolean;
      }>(
        `SELECT id, email, is_active, COALESCE(is_platform_admin, false) AS is_platform_admin
         FROM doctors WHERE id = $1`,
        [payload.sub],
      );
    }

    if (!userRecord?.is_active) {
      throw new UnauthorizedException('Cuenta inactiva');
    }

    const user: AuthUser = {
      doctorId: userRecord.id,
      userType,
      email: userRecord.email,
      isPlatformAdmin: userRecord.is_platform_admin,
    };

    // 3. Rutas de admin de plataforma
    const needsAdmin = this.reflector.getAllAndOverride<boolean>(IS_ADMIN, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (needsAdmin && !userRecord.is_platform_admin) {
      throw new ForbiddenException('Requiere permisos de administrador');
    }

    // 4. Si viene organización, verificar membresía.
    //    Solo aplica a doctors y staff, no a pacientes.
    const orgId = req.header('x-organization-id');
    if (orgId && userType !== 'patient') {
      // Médicos: organization_doctors. Staff (secretaría, enfermería…): organization_members con su rol.
      const membership = userType === 'staff'
        ? await this.db.queryOne<{ role: string }>(
            `SELECT r.code AS role FROM organization_members om JOIN roles r ON r.id = om.role_id
             WHERE om.organization_id = $1 AND om.staff_id = $2 AND om.is_active = true`,
            [orgId, userRecord.id],
          )
        : await this.db.queryOne<{ role: string }>(
            `SELECT role FROM organization_doctors
             WHERE organization_id = $1 AND doctor_id = $2 AND is_active = true`,
            [orgId, userRecord.id],
          );

      if (!membership) {
        throw new ForbiddenException('No tenés acceso a esta organización');
      }

      user.organizationId = orgId;
      user.orgRole = membership.role;
    }

    // Secretaría / recepción: gestionan turnos y pacientes, pero no acceden a datos clínicos
    if (userType === 'staff') {
      const path = String(req.originalUrl || req.url || '').split('?')[0];
      if (/^\/api\/v1\/(medical-records|prescriptions|consent|consents|informed-consents)(\/|$)/.test(path) || /\/api\/v1\/patients\/[^/]+\/(timeline|history)(\/|$)/.test(path)) {
        throw new ForbiddenException('La secretaría no tiene acceso a la historia clínica');
      }
    }

    req.user = user;
    return true;
  }

  private extractToken(req: Request): string | undefined {
    const [type, token] = req.header('authorization')?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
