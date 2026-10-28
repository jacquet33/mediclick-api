import { Controller, Post, Body, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { Request } from 'express';
import { ActivityService } from '../activity/activity.service';
import { Public } from '../../common/guards/auth.guard';
import { StrictThrottle } from '../../common/decorators/throttle.decorator';
import { OAuthService } from './oauth.service';
import { GoogleLoginDto, AppleLoginDto } from '../../common/dto/auth.dto';

@Public()
@StrictThrottle()
@Controller('api/v1/auth')
export class OAuthController {
  constructor(private oauthService: OAuthService, private act: ActivityService) {}

  /**
   * POST /auth/google
   * 
   * Login/registro con Google Sign-In.
   * El cliente envía el idToken que recibe del SDK de Google.
   * 
   * Si el doctor no existe, se crea automáticamente con
   * matrícula pendiente (isNewUser: true, needsLicense: true).
   */
  @Post('google')
  @HttpCode(HttpStatus.OK)
  async googleLogin(@Body() dto: GoogleLoginDto, @Req() req: Request) {
    const ctx = { ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip, ua: req.headers['user-agent'] as string };
    try {
      const r: any = await this.oauthService.loginWithGoogle(dto);
      this.act.registrar({ kind: r?.isNewUser ? 'google_signup' : 'google_ok', userType: r?.userType || r?.user?.user_type, email: r?.user?.email, detail: (dto as any).intent, ...ctx });
      return r;
    } catch (e: any) {
      this.act.registrar({ kind: 'google_fail', detail: e?.message, ...ctx });
      throw e;
    }
  }

  /**
   * POST /auth/apple
   * 
   * Login/registro con Sign in with Apple.
   * El cliente envía identityToken + authorizationCode.
   * 
   * NOTA: Apple solo envía nombre y email la primera vez.
   * Las siguientes veces solo viene el identityToken.
   */
  @Post('apple')
  @HttpCode(HttpStatus.OK)
  async appleLogin(@Body() dto: AppleLoginDto) {
    return this.oauthService.loginWithApple(dto);
  }
}
