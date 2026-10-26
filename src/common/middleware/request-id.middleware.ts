import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * Assigns a unique request ID to every incoming request.
 * - If the client sends X-Request-Id, it's reused (max 64 chars, alphanumeric + dashes).
 * - Otherwise a new UUIDv4 is generated.
 * - The ID is attached to both the request object and the response header.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.headers['x-request-id'] as string | undefined;
    const requestId =
      incoming && /^[a-zA-Z0-9-]{1,64}$/.test(incoming)
        ? incoming
        : randomUUID();

    (req as any).requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}
