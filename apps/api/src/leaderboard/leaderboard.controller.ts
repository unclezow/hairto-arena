import { Controller, Get, Header, Query } from '@nestjs/common';
import { Authenticated, CurrentUser } from '../auth/auth.guard.js';
import type { SessionWithToken } from '../auth/session.service.js';
import { paginationQuerySchema } from '../common/pagination.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { LeaderboardService, leaderboardQuery } from './leaderboard.service.js';

const listQuery = paginationQuerySchema.extend(leaderboardQuery.shape);
type ListQuery = { limit: number; cursor?: string; season?: string };

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboard: LeaderboardService) {}

  /** Ranking by score, then wins, then time reached; min. 10 duels. */
  @Get()
  @Header('Cache-Control', 'public, max-age=3')
  get(@Query(new ZodValidationPipe(listQuery)) query: ListQuery) {
    return this.leaderboard.get(query.season, query.limit, query.cursor);
  }

  @Get('me')
  @Authenticated()
  @Header('Cache-Control', 'no-store')
  me(
    @CurrentUser() user: SessionWithToken,
    @Query(new ZodValidationPipe(leaderboardQuery)) query: { season?: string },
  ) {
    return this.leaderboard.me(user.accountId, query.season);
  }
}
