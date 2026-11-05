import { CanActivate, ExecutionContext, Injectable, Logger, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Env } from '../config/env.js';
import { AppException, upstreamUnavailable } from '../common/errors.js';
import { SessionService } from '../auth/session.service.js';
import { RateLimitService } from './rate-limit.service.js';

export type RateLimitGroup = 'read' | 'write' | 'auth' | 'duel' | 'admin';

const LIMIT_SETTING = {
  read: 'RATE_LIMIT_READ_PER_WINDOW',
  write: 'RATE_LIMIT_WRITE_PER_WINDOW',
  auth: 'RATE_LIMIT_AUTH_PER_WINDOW',
  duel: 'RATE_LIMIT_DUEL_PER_WINDOW',
  admin: 'RATE_LIMIT_ADMIN_PER_WINDOW',
} as const satisfies Record<RateLimitGroup, keyof Env>;

const RATE_LIMIT_KEY = 'rateLimitGroup';

/** Overrides the default group (GET/HEAD/OPTIONS = read, everything else = write). */
export const RateLimit = (group: RateLimitGroup) => SetMetadata(RATE_LIMIT_KEY, group);

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const group =
      this.reflector.getAllAndOverride<RateLimitGroup | undefined>(RATE_LIMIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? (['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? 'read' : 'write');
    const limit = this.config.get(LIMIT_SETTING[group], { infer: true });
    const windowSec = this.config.get('RATE_LIMIT_WINDOW_SEC', { infer: true });

    try {
      const session = await this.sessions.peek(req.headers.authorization);
      const result = await this.limiter.hit(
        `${group}:${session?.accountId ?? req.ip ?? 'unknown'}`,
        limit,
        windowSec,
      );
      if (result.allowed) return true;
      res.setHeader('Retry-After', String(result.retryAfterSec));
      throw new AppException(429, 'RATE_LIMITED', 'Too many requests', {
        retryAfterSec: result.retryAfterSec,
      });
    } catch (err) {
      if (err instanceof AppException) throw err;
      // Redis is down: reads keep working, writes fail closed.
      this.logger.warn(`Rate limiter unavailable: ${(err as Error).message}`);
      if (group === 'read') return true;
      throw upstreamUnavailable('Rate limiter unavailable');
    }
  }
}
