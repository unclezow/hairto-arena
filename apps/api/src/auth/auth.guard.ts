import {
  applyDecorators,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { forbidden, unauthenticated, upstreamUnavailable } from '../common/errors.js';
import {
  bearerToken,
  SessionService,
  type Role,
  type SessionWithToken,
} from './session.service.js';

export type AuthedRequest = Request & { user: SessionWithToken };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = bearerToken(req.headers.authorization);
    if (!token) throw unauthenticated();
    let session: SessionWithToken | null;
    try {
      session = await this.sessions.get(token);
    } catch {
      throw upstreamUnavailable('Session store unavailable');
    }
    if (!session) throw unauthenticated('Invalid or expired session');
    req.user = session;
    return true;
  }
}

const ROLES_KEY = 'roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const { user } = context.switchToHttp().getRequest<AuthedRequest>();
    if (!required.includes(user.role)) throw forbidden('Admin role required');
    return true;
  }
}

/** Requires a valid session. */
export const Authenticated = () => applyDecorators(UseGuards(AuthGuard));

/** Requires a valid session whose account is on the admin allowlist (`ADMIN_ACCOUNTS`). */
export const AdminOnly = () =>
  applyDecorators(
    SetMetadata(ROLES_KEY, ['admin'] satisfies Role[]),
    UseGuards(AuthGuard, RolesGuard),
  );

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionWithToken =>
    ctx.switchToHttp().getRequest<AuthedRequest>().user,
);
