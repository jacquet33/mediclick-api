import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { OAuthService, GoogleLoginDto, AppleLoginDto } from './oauth.service';

@Controller('api/v1/auth')
export class OAuthController {
  constructor(private oauthService: OAuthService) {}

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
  async googleLogin(@Body() dto: GoogleLoginDto) {
    return this.oauthService.loginWithGoogle(dto);
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
