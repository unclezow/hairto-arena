import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../common/errors.js';
import type { AuthedRequest } from '../auth/auth.guard.js';
import type { Env } from '../config/env.js';

/** Changes need a wallet signature from the last few minutes; reading does not. */
@Injectable()
export class FreshSignatureGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<AuthedRequest>();
    const maxAge = this.config.get('ADMIN_FRESH_SIGNATURE_SEC', { infer: true });
    if (Math.floor(Date.now() / 1000) - user.signedAt > maxAge) {
      throw new AppException(401, 'REAUTH_REQUIRED', 'Sign in again to change anything', {
        maxAgeSec: maxAge,
      });
    }
    return true;
  }
}

/** Put on every handler that changes something. Runs after `AdminOnly`, so the session is already known. */
export const FreshSignature = () => applyDecorators(UseGuards(FreshSignatureGuard));
