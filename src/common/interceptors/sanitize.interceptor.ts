import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * Global interceptor that sanitizes all incoming string values
 * in request body/query/params to prevent stored XSS attacks.
 *
 * Strips HTML tags, script content, and dangerous attributes
 * while preserving normal text content.
 */
@Injectable()
export class SanitizeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    if (request.body && typeof request.body === 'object') {
      request.body = this.sanitizeDeep(request.body);
    }
    if (request.query && typeof request.query === 'object') {
      request.query = this.sanitizeDeep(request.query);
    }

    return next.handle();
  }

  private sanitizeDeep(obj: any): any {
    if (typeof obj === 'string') {
      return this.sanitizeString(obj);
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeDeep(item));
    }
    if (obj && typeof obj === 'object' && !(obj instanceof Date)) {
      const result: any = {};
      for (const key of Object.keys(obj)) {
        result[key] = this.sanitizeDeep(obj[key]);
      }
      return result;
    }
    return obj;
  }

  private sanitizeString(value: string): string {
    if (!value) return value;

    return value
      // Remove script tags and their content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      // Remove on* event handlers (onclick, onerror, etc.)
      .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
      // Remove javascript: protocol
      .replace(/javascript\s*:/gi, '')
      // Remove data: protocol (potential vector)
      .replace(/data\s*:\s*text\/html/gi, '')
      // Strip remaining HTML tags but keep content
      .replace(/<\/?[^>]+(>|$)/g, '')
      // Trim whitespace
      .trim();
  }
}
