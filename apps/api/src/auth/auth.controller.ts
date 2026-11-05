import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { accountIdSchema, ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { AuthService } from './auth.service.js';
import { Authenticated, CurrentUser } from './auth.guard.js';
import type { SessionWithToken } from './session.service.js';
import { SessionService } from './session.service.js';

const nonceBody = z.object({ accountId: accountIdSchema });
const verifyBody = z.object({
  accountId: accountIdSchema,
  publicKey: z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,50}$/, 'must be ed25519:<base58>'),
  signature: z.string().min(64).max(200),
});

/** NEAR wallet sign-in with NEP-413 `signMessage`. */
@Controller('auth')
@RateLimit('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Post('nonce')
  @HttpCode(200)
  nonce(@Body(new ZodValidationPipe(nonceBody)) body: z.infer<typeof nonceBody>) {
    return this.auth.createNonce(body.accountId);
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@Body(new ZodValidationPipe(verifyBody)) body: z.infer<typeof verifyBody>) {
    const session = await this.auth.verify(body);
    return { token: session.token, accountId: session.accountId, role: session.role };
  }

  @Post('logout')
  @HttpCode(204)
  @Authenticated()
  async logout(@CurrentUser() user: SessionWithToken) {
    await this.sessions.revoke(user.token);
  }

  @Get('me')
  @Authenticated()
  me(@CurrentUser() user: SessionWithToken) {
    return { accountId: user.accountId, role: user.role };
  }
}
