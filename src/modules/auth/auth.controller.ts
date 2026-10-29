import { Controller, Post, Body, HttpCode, HttpStatus, ForbiddenException, Req, UseGuards, HttpException } from '@nestjs/common';
import { CaptchaGuard } from '../../common/guards/captcha.guard';
import { RedisService } from '../../common/redis.service';
import { Request } from 'express';
import { ActivityService } from '../activity/activity.service';
import { Public } from '../../common/guards/auth.guard';
import { StrictThrottle } from '../../common/decorators/throttle.decorator';
import { AuthService } from './auth.service';
import {
  LoginDto, RegisterDto, RegisterPatientDto, RegisterStaffDto,
  RefreshTokenDto, ChangePasswordDto,
} from '../../common/dto/auth.dto';
import { AuthUser } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Public()
@StrictThrottle()
@Controller('api/v1/auth')
export class AuthController {
  constructor(private authService: AuthService, private act: ActivityService, private redis: RedisService) {}

  /** Bloqueo por cuenta: 8 intentos fallidos en 15 min traban ese email 15 min (aunque el atacante cambie de IP) */
  private claveBloqueo(email: string) { return `login_fail:${String(email || '').toLowerCase().trim()}`; }
  private async bloqueada(email: string) {
    const n = await this.redis.client?.get(this.claveBloqueo(email)).catch(() => null);
    return Number(n || 0) >= 8;
  }
  private async falla(email: string) {
    const c = this.redis.client; if (!c) return;
    const k = this.claveBloqueo(email);
    const n = await c.incr(k).catch(() => 0);
    if (n === 1) await c.expire(k, 900).catch(() => undefined);
  }

  private ctx(req: Request) { return { ip: (req.headers['cf-connecting-ip'] as string) || req.ip, ua: req.headers['user-agent'] as string }; }

  /** Login unificado — detecta doctor/paciente/staff automáticamente */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    if (await this.bloqueada(dto.email)) {
      this.act.registrar({ kind: 'login_fail', email: dto.email, detail: 'bloqueada por intentos', ...this.ctx(req) });
      throw new HttpException('Demasiados intentos fallidos con este email. Esperá 15 minutos o recuperá tu contraseña.', 429);
    }
    try {
      const r: any = await this.authService.login(dto);
      await this.redis.client?.del(this.claveBloqueo(dto.email)).catch(() => undefined);
      this.act.registrar({ kind: 'login_ok', userType: r?.userType || r?.user?.user_type, userId: r?.user?.id || r?.user?.user_id, email: dto.email, ...this.ctx(req) });
      return r;
    } catch (e: any) {
      this.act.registrar({ kind: 'login_fail', email: dto.email, detail: e?.message, ...this.ctx(req) });
      if (e?.status === 401) await this.falla(dto.email);
      throw e;
    }
  }

  /** Registro de médico */
  @Post('register')
  @UseGuards(CaptchaGuard)
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    try {
      const r: any = await this.authService.register(dto);
      this.act.registrar({ kind: 'register_doctor', userType: 'doctor', userId: r?.user?.id || r?.doctor?.id, email: dto.email, ...this.ctx(req) });
      return r;
    } catch (e: any) {
      this.act.registrar({ kind: 'register_fail', userType: 'doctor', email: dto.email, detail: e?.message, ...this.ctx(req) });
      throw e;
    }
  }

  /** Registro de paciente */
  @Post('register/patient')
  @UseGuards(CaptchaGuard)
  async registerPatient(@Body() dto: RegisterPatientDto, @Req() req: Request) {
    try {
      const r: any = await this.authService.registerPatient(dto);
      this.act.registrar({ kind: 'register_patient', userType: 'patient', email: dto.email, ...this.ctx(req) });
      return r;
    } catch (e: any) {
      this.act.registrar({ kind: 'register_fail', userType: 'patient', email: dto.email, detail: e?.message, ...this.ctx(req) });
      throw e;
    }
  }

  /** Registro de staff (admin, secretaria, enfermero, etc.) */
  @Post('register/staff')
  async registerStaff(@Body() _dto: RegisterStaffDto) {
    // Era público y permitía sumarse a cualquier consultorio: ahora el titular crea las cuentas desde Equipo
    // (POST /api/v1/organizations/:orgId/members/staff).
    throw new ForbiddenException('Las cuentas de secretaría las crea el médico titular desde Equipo y roles');
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    const userId = dto.userId || dto.doctorId;
    return this.authService.refreshTokens(userId, dto.refreshToken);
  }
}

/** Acciones sobre la propia sesión: requieren estar logueado y usan el usuario del token, nunca uno del body. */
@StrictThrottle()
@Controller('api/v1/auth')
export class AuthSessionController {
  constructor(private authService: AuthService) {}

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() u: AuthUser) {
    await this.authService.logout(u.doctorId);
    return { message: 'Sesión cerrada' };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(@CurrentUser() u: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.authService.changePassword(u.doctorId, dto.currentPassword, dto.newPassword);
    return { message: 'Contraseña actualizada' };
  }
}
