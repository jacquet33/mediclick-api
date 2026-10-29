import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Limita por IP real del cliente. Detrás de Traefik `req.ip` sería siempre la IP del proxy
 * (todos compartían el mismo cupo); con `trust proxy` + CF-Connecting-IP se usa la del visitante.
 */
@Injectable()
export class IpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const cf = String(req.headers?.['cf-connecting-ip'] || '').trim();
    return cf || req.ip || req.socket?.remoteAddress || 'desconocido';
  }
}
