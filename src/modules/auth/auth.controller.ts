import { Controller, Post, Body, HttpCode, HttpStatus, ForbiddenException, Req } from '@nestjs/common';
import { Request } from 'express';
import { ActivityService } from '../activity/activity.service';
import { Public } from '../../common/guards/auth.guard';
import { StrictThrottle } from '../../common/decorators/throttle.decorator';
import { AuthService } from './auth.service';
import {
  LoginDto, RegisterDto, RegisterPatientDto, RegisterStaffDto,
  RefreshTokenDto, ChangePasswordDto,
} from '../../common/dto/auth.dto';
import { LogoutDto } from '../../common/dto/misc.dto';

@Public()
@StrictThrottle()
@Controller('api/v1/auth')
export class AuthController {
  constructor(private authService: AuthService, private act: ActivityService) {}

  private ctx(req: Request) { return { ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip, ua: req.headers['user-agent'] as string }; }

  /** Login unificado — detecta doctor/paciente/staff automáticamente */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    try {
      const r: any = await this.authService.login(dto);
      this.act.registrar({ kind: 'login_ok', userType: r?.userType || r?.user?.user_type, userId: r?.user?.id || r?.user?.user_id, email: dto.email, ...this.ctx(req) });
      return r;
    } catch (e: any) {
      this.act.registrar({ kind: 'login_fail', email: dto.email, detail: e?.message, ...this.ctx(req) });
      throw e;
    }
  }

  /** Registro de médico */
  @Post('register')
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

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: LogoutDto) {
    const userId = dto.userId || (dto as any).doctorId;
    await this.authService.logout(userId);
    return { message: 'Sesión cerrada' };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(@Body() dto: ChangePasswordDto) {
    const userId = dto.userId || dto.doctorId;
    await this.authService.changePassword(userId, dto.currentPassword, dto.newPassword);
    return { message: 'Contraseña actualizada' };
  }
}
