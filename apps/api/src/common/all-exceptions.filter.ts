import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { AppException, type ErrorCode } from './errors.js';

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
  501: 'NOT_IMPLEMENTED',
  502: 'UPSTREAM_UNAVAILABLE',
  503: 'UPSTREAM_UNAVAILABLE',
};

/** Every error leaves the API as `{ error: { code, message, details? } }` and never leaks a stack trace. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, code, message, details } = this.normalize(exception);
    if (status >= 500 && status !== 501 && status !== 503) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    res
      .status(status)
      .json({ error: { code, message, ...(details === undefined ? {} : { details }) } });
  }

  private normalize(exception: unknown): {
    status: number;
    code: ErrorCode;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof ZodError) {
      return {
        status: 400,
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ?? exception.message);
      return {
        status,
        code: CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED'),
        message: Array.isArray(message) ? message.join('; ') : message,
      };
    }
    return { status: 500, code: 'INTERNAL', message: 'Internal server error' };
  }
}
