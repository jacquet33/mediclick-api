import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Public } from '../../common/guards/auth.guard';
import { AuthService, RegisterDto, RegisterPatientDto, LoginDto } from './auth.service';

@Public()
@Controller('api/v1/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /** Login unificado — detecta doctor/paciente/staff automáticamente */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /** Registro de médico */
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /** Registro de paciente */
  @Post('register/patient')
  async registerPatient(@Body() dto: RegisterPatientDto) {
    return this.authService.registerPatient(dto);
  }

  /** Registro de staff (admin, secretaria, enfermero, etc.) */
  @Post('register/staff')
  async registerStaff(@Body() dto: {
    email: string; password: string; firstName: string; lastName: string;
    phone?: string; organizationId: string; roleCode: string;
  }) {
    return this.authService.registerStaff(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: { userId: string; refreshToken: string }) {
    // backward compat: accept doctorId too
    const userId = body.userId || (body as any).doctorId;
    return this.authService.refreshTokens(userId, body.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() body: { userId: string }) {
    const userId = body.userId || (body as any).doctorId;
    await this.authService.logout(userId);
    return { message: 'Sesión cerrada' };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() body: { userId: string; currentPassword: string; newPassword: string },
  ) {
    const userId = body.userId || (body as any).doctorId;
    await this.authService.changePassword(userId, body.currentPassword, body.newPassword);
    return { message: 'Contraseña actualizada' };
  }
}
