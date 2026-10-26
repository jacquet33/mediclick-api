import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
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
  async registerStaff(@Body() dto: RegisterStaffDto) {
    return this.authService.registerStaff(dto);
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
