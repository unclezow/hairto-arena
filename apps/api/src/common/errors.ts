import { HttpException } from '@nestjs/common';

/** Stable machine-readable error codes. Feature modules may add their own strings. */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'UNAUTHENTICATED'
  | 'REAUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'UPSTREAM_UNAVAILABLE'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL'
  | (string & {});

export class AppException extends HttpException {
  constructor(
    status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppException(400, 'VALIDATION_FAILED', message, details);
export const notFound = (message = 'Not found') => new AppException(404, 'NOT_FOUND', message);
export const unauthenticated = (message = 'Authentication required') =>
  new AppException(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'Forbidden', code: ErrorCode = 'FORBIDDEN') =>
  new AppException(403, code, message);
export const conflict = (code: ErrorCode, message: string) => new AppException(409, code, message);
export const upstreamUnavailable = (message: string, details?: unknown) =>
  new AppException(503, 'UPSTREAM_UNAVAILABLE', message, details);
