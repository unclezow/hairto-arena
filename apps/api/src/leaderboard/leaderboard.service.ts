import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { badRequest } from '../common/errors.js';
import { decodeCursor, toPage } from '../common/pagination.js';
import { ParamsService } from '../config/params.service.js';
import { LEADERBOARD_VERSION_KEY } from '../redis/keys.js';
import { RedisService } from '../redis/redis.service.js';
import { FreshnessService } from '../read-model/freshness.service.js';
import { nextBetterTier, tierOf } from '../read-model/prize-tiers.js';
import { ScoreboardService } from '../read-model/scoreboard.service.js';
import { SeasonLookup } from '../read-model/season-lookup.service.js';

export const leaderboardQuery = z.object({ season: z.string().optional() });

/** Pages are cached this long; a score sync also invalidates them through the version key. */
const CACHE_SEC = 3;
const UNRANKED_LIMIT = 50;

@Injectable()
export class LeaderboardService {
  constructor(
    private readonly scoreboard: ScoreboardService,
    private readonly seasons: SeasonLookup,
    private readonly params: ParamsService,
    private readonly redis: RedisService,
    private readonly freshness: FreshnessService,
  ) {}

  async get(seasonParam: string | undefined, limit: number, cursor: string | undefined) {
    const season = await this.seasons.resolve(seasonParam);
    if (!season)
      return {
        season: null,
        items: [],
        unranked: [],
        nextCursor: null,
        ...(await this.freshness.get()),
      };

    const afterRank = cursor ? this.rankOf(cursor) : 0;
    const version = (await this.redis.client.get(LEADERBOARD_VERSION_KEY).catch(() => null)) ?? '0';
    const key = `lb:${version}:${season.id}:${limit}:${afterRank}`;
    const cached = await this.redis.client.get(key).catch(() => null);
    if (cached) return JSON.parse(cached) as unknown;

    const minDuels = this.params.score.minDuelsForLeaderboard;
    const curve = this.params.prizeCurveBps;
    const rows = await this.scoreboard.ranked(season.id, minDuels, afterRank, limit + 1);
    const page = toPage(rows, limit, (last) => ({ rank: last.rank }));

    const unranked =
      afterRank === 0
        ? (await this.scoreboard.unranked(season.id, minDuels, UNRANKED_LIMIT)).map((r) => ({
            ...r,
            duelsToQualify: Math.max(0, minDuels - r.duels),
          }))
        : [];

    const body = {
      season: { id: season.id },
      minDuels,
      items: page.items.map((r) => ({ ...r, prizeTier: tierOf(curve, r.rank) })),
      unranked,
      nextCursor: page.nextCursor,
      ...(await this.freshness.get()),
    };
    await this.redis.client.set(key, JSON.stringify(body), 'EX', CACHE_SEC).catch(() => undefined);
    return body;
  }

  /** Where a fighter stands and what it takes to reach the next prize tier. */
  async me(address: string, seasonParam: string | undefined) {
    const season = await this.seasons.resolve(seasonParam);
    if (!season)
      return {
        season: null,
        rank: null,
        points: 0,
        duels: 0,
        duelsToQualify: this.params.score.minDuelsForLeaderboard,
      };

    const minDuels = this.params.score.minDuelsForLeaderboard;
    const curve = this.params.prizeCurveBps;
    const score = await this.scoreboard.scoreOf(season.id, address);
    const ranked = await this.scoreboard.rankOf(season.id, minDuels, address);

    if (!ranked) {
      const duels = score?.duels ?? 0;
      return {
        season: { id: season.id },
        rank: null,
        points: score?.points ?? 0,
        wins: score?.wins ?? 0,
        duels,
        duelsToQualify: Math.max(0, minDuels - duels),
      };
    }

    const better = nextBetterTier(curve, ranked.rank);
    const holder = better ? await this.scoreboard.holderAt(season.id, minDuels, better.to) : null;
    return {
      season: { id: season.id },
      rank: ranked.rank,
      points: ranked.points,
      wins: ranked.wins,
      duels: ranked.duels,
      prizeTier: tierOf(curve, ranked.rank),
      nextTier: better
        ? {
            ...better,
            pointsToReach: holder ? Math.max(1, holder.points - ranked.points + 1) : null,
          }
        : null,
    };
  }

  private rankOf(cursor: string): number {
    const c = decodeCursor<{ rank?: unknown }>(cursor);
    if (typeof c.rank !== 'number' || !Number.isInteger(c.rank) || c.rank < 0)
      throw badRequest('Invalid cursor');
    return c.rank;
  }
}
