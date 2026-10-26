import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Logs HTTP requests with timing, status code, and request ID.
 * Skips health checks to avoid log noise.
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    // Skip health check noise
    if (req.path === '/api/v1/health') return next();

    const start = Date.now();
    const { method, path } = req;
    const requestId = (req as any).requestId || '-';

    res.on('finish', () => {
      const ms = Date.now() - start;
      const status = res.statusCode;
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'log';

      this.logger[level](
        `${method} ${path} ${status} ${ms}ms [${requestId}]`,
      );
    });

    next();
  }
}
