import { Throttle, SkipThrottle } from '@nestjs/throttler';

/**
 * Rate limiting estricto para endpoints de autenticación.
 * 5 requests por 60 segundos — previene fuerza bruta.
 */
export const StrictThrottle = () => Throttle({ default: { ttl: 60000, limit: 5 } });

/**
 * Rate limiting para endpoints públicos (booking page).
 * 20 requests por 60 segundos — suficiente para uso normal,
 * previene scraping.
 */
export const PublicThrottle = () => Throttle({ default: { ttl: 60000, limit: 20 } });

/**
 * Sin rate limiting — para endpoints internos o health checks.
 */
export { SkipThrottle };
