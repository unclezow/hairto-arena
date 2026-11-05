import { Controller, Get, Header, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService, type SessionWithToken } from '../auth/session.service.js';
import { Authenticated, CurrentUser } from '../auth/auth.guard.js';
import { forbidden } from '../common/errors.js';
import { paginationQuerySchema } from '../common/pagination.js';
import { ParseAccountIdPipe, ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FreshnessService } from '../read-model/freshness.service.js';
import { WalletStatusService } from '../read-model/wallet-status.service.js';
import { fighterListQuery, FightersService } from './fighters.service.js';

/** Fighter catalog for backers and fighter profiles. */
@Controller('fighters')
export class FightersController {
  constructor(
    private readonly fighters: FightersService,
    private readonly freshness: FreshnessService,
    private readonly wallets: WalletStatusService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * With a session that may pick, each fighter says whether it can be picked now. Anonymous callers get the
   * same list and `pick.canPick: false` with the reason they are not signed in.
   */
  @Get()
  @Header('Cache-Control', 'public, max-age=3')
  async list(
    @Req() req: Request,
    @Query(new ZodValidationPipe(fighterListQuery.extend(paginationQuerySchema.shape)))
    query: ReturnType<typeof fighterListQuery.parse> & { limit: number; cursor?: string },
  ) {
    const { limit, cursor, ...filters } = query;
    const [page, freshness, session] = await Promise.all([
      this.fighters.list(filters, limit, cursor),
      this.freshness.get(),
      this.sessions.peek(req.headers.authorization),
    ]);

    const pick = session
      ? (await this.wallets.forAddress(session.accountId)).pick
      : {
          canPick: false,
          reason: 'UNAUTHENTICATED' as const,
          seasonId: page.season?.id ?? null,
          pickedFighter: null,
        };
    return {
      ...page,
      items: page.items.map((f) => ({
        ...f,
        pickable: pick.canPick && f.address !== session?.accountId,
      })),
      pick: { canPick: pick.canPick, reason: pick.reason },
      ...freshness,
    };
  }

  @Get(':accountId')
  @Header('Cache-Control', 'public, max-age=3')
  profile(@Param('accountId', ParseAccountIdPipe) accountId: string) {
    return this.fighters.profile(accountId);
  }

  @Get(':accountId/duels')
  @Authenticated()
  @Header('Cache-Control', 'private, no-store')
  async history(
    @CurrentUser() user: SessionWithToken,
    @Param('accountId', ParseAccountIdPipe) address: string,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: { limit: number; cursor?: string },
  ) {
    if (user.accountId !== address) throw forbidden('Match history is private to its fighter');
    const [page, freshness] = await Promise.all([
      this.fighters.history(address, query.limit, query.cursor),
      this.freshness.get(),
    ]);
    return { ...page, ...freshness };
  }
}
