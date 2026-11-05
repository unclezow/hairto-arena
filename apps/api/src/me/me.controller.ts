import { Controller, Get, Header, Query } from '@nestjs/common';
import { z } from 'zod';
import { Authenticated, CurrentUser } from '../auth/auth.guard.js';
import type { SessionWithToken } from '../auth/session.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MeService } from './me.service.js';

/** `live=true` reads balances from the chain instead of the synced copy, which trails by a few blocks. */
const liveQuery = z.object({
  live: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

@Controller('me')
@Authenticated()
export class MeController {
  constructor(private readonly me: MeService) {}

  /** Role, balances, and whether the wallet can play or pick, with the reason when not. */
  @Get('status')
  @Header('Cache-Control', 'no-store')
  status(
    @CurrentUser() user: SessionWithToken,
    @Query(new ZodValidationPipe(liveQuery)) q: { live: boolean },
  ) {
    return this.me.status(user.accountId, q.live);
  }

  /** Backer dashboard: principal, claimable yield, pot contribution, bonus estimate. */
  @Get('backer')
  @Header('Cache-Control', 'no-store')
  backer(
    @CurrentUser() user: SessionWithToken,
    @Query(new ZodValidationPipe(liveQuery)) q: { live: boolean },
  ) {
    return this.me.backer(user.accountId, q.live);
  }

  /** Scored duels played today, and when the UTC day rolls over. */
  @Get('daily')
  @Header('Cache-Control', 'no-store')
  daily(@CurrentUser() user: SessionWithToken) {
    return this.me.daily(user.accountId);
  }

  @Get('fighter')
  @Header('Cache-Control', 'no-store')
  fighter(
    @CurrentUser() user: SessionWithToken,
    @Query(new ZodValidationPipe(liveQuery)) q: { live: boolean },
  ) {
    return this.me.fighter(user.accountId, q.live);
  }
}
