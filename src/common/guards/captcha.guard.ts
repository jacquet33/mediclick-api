import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Cloudflare Turnstile en formularios públicos (alta de médico/paciente, reserva de turno, farmacias, pedidos de datos).
 * - Sin TURNSTILE_SECRET configurado no hace nada (no rompe nada mientras no esté activado).
 * - Solo se exige a navegadores (traen cabecera Origin); las apps nativas no pueden resolverlo y
 *   quedan cubiertas por el límite por IP y por cuenta.
 * - Si Cloudflare no responde se deja pasar (mejor un bot más que un paciente sin turno) y se registra.
 */
@Injectable()
export class CaptchaGuard implements CanActivate {
  private readonly logger = new Logger('Captcha');
  constructor(private config: ConfigService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const secret = this.config.get<string>('TURNSTILE_SECRET');
    if (!secret) return true;
    const req = ctx.switchToHttp().getRequest();
    if (!req.headers?.origin) return true;
    const token = String(req.headers['x-captcha-token'] || '').trim();
    if (!token) throw new ForbiddenException({ message: 'Confirmá que no sos un robot y probá de nuevo', captcha: true });
    try {
      const body = new URLSearchParams({ secret, response: token });
      const ip = String(req.headers['cf-connecting-ip'] || req.ip || '');
      if (ip) body.set('remoteip', ip);
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(6000) });
      const j: any = await r.json();
      if (j?.success) return true;
      this.logger.warn(`Captcha rechazado: ${(j?.['error-codes'] || []).join(',')}`);
    } catch (e: any) {
      this.logger.warn(`Captcha sin verificar (Cloudflare no respondió): ${e?.message}`);
      return true;
    }
    throw new ForbiddenException({ message: 'No pudimos confirmar que no sos un robot. Probá de nuevo', captcha: true });
  }
}
