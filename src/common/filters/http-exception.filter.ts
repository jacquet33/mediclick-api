import {
  ExceptionFilter, Catch, ArgumentsHost,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Global exception filter for production-safe error responses.
 *
 * - Returns consistent JSON shape for all errors
 * - Hides internal stack traces from clients
 * - Logs full error details server-side
 * - Preserves NestJS validation error details (class-validator)
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Error interno del servidor';
    let errors: string[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse();

      if (typeof exResponse === 'string') {
        message = exResponse;
      } else if (typeof exResponse === 'object' && exResponse !== null) {
        const r = exResponse as any;
        message = r.message || r.error || message;

        // class-validator returns message as array
        if (Array.isArray(r.message)) {
          errors = r.message;
          message = 'Error de validación';
        }
      }
    } else if (exception instanceof Error) {
      // Log unexpected errors with full stack
      this.logger.error(
        `Unhandled exception: ${exception.message}`,
        exception.stack,
        `${request.method} ${request.url}`,
      );
    } else {
      this.logger.error('Unknown exception type', String(exception));
    }

    // Log 5xx errors always
    if (status >= 500) {
      this.logger.error(
        `${status} ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      ...(errors && { errors }),
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
