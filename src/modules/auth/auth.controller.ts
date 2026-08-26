import { Controller, Post, Body, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { Public } from '../../common/guards/auth.guard';
import { AuthService, RegisterDto, LoginDto } from './auth.service';

@Public()
@Controller('api/v1/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: { doctorId: string; refreshToken: string }) {
    return this.authService.refreshTokens(body.doctorId, body.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() body: { doctorId: string }) {
    await this.authService.logout(body.doctorId);
    return { message: 'Sesión cerrada' };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() body: { doctorId: string; currentPassword: string; newPassword: string },
  ) {
    await this.authService.changePassword(body.doctorId, body.currentPassword, body.newPassword);
    return { message: 'Contraseña actualizada' };
  }
}
