import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { badRequest, notFound } from '../common/errors.js';
import { decodeCursor, toPage, type Page } from '../common/pagination.js';
import { Prisma } from '../generated/prisma/client.js';
import { DuelStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FreshnessService } from '../read-model/freshness.service.js';
import { SeasonLookup } from '../read-model/season-lookup.service.js';

export const FIGHTER_SORTS = ['points', 'wins', 'duels', 'consistency'] as const;
export type FighterSort = (typeof FIGHTER_SORTS)[number];

/** Win rate is taken over this many most recent counted duels. */
export const CONSISTENCY_WINDOW = 20;

export const fighterListQuery = z.object({
  sort: z.enum(FIGHTER_SORTS).default('points'),
  search: z
    .string()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{0,64}$/, 'must be the start of an account id')
    .optional(),
  season: z.string().optional(),
});

/** What decides the order for each sort. Constants, so they are safe to inline as SQL. */
const SORT_EXPR: Record<FighterSort, Prisma.Sql> = {
  points: Prisma.raw('points'),
  wins: Prisma.raw('wins'),
  duels: Prisma.raw('duels'),
  consistency: Prisma.raw('COALESCE(consistency, -1)'),
};

interface FighterRow {
  address: string;
  status: string;
  points: number;
  duels: number;
  wins: number;
  backers: number;
  consistency: number | null;
  sortv: number;
}

export interface FighterListItem {
  address: string;
  status: string;
  points: number;
  duels: number;
  wins: number;
  consistency: number | null;
  backerCount: number;
}

@Injectable()
export class FightersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seasons: SeasonLookup,
    private readonly freshness: FreshnessService,
  ) {}

  async list(
    query: z.infer<typeof fighterListQuery>,
    limit: number,
    cursor: string | undefined,
  ): Promise<
    Page<FighterListItem> & {
      season: { id: number } | null;
      consistencyWindow: number;
      sort: FighterSort;
    }
  > {
    const season = await this.seasons.resolve(query.season);
    const seasonId = season?.id ?? -1;
    const after = cursor ? this.parseCursor(cursor) : null;

    const cursorWhere = after
      ? Prisma.sql`(sortv < ${after.v}::float8 OR (sortv = ${after.v}::float8 AND address > ${after.a}))`
      : Prisma.sql`TRUE`;
    const searchWhere = query.search
      ? Prisma.sql`f.address LIKE ${query.search.replace(/_/g, '\\_') + '%'}`
      : Prisma.sql`TRUE`;

    const rows = await this.prisma.$queryRaw<FighterRow[]>`
      WITH base AS (
        SELECT f.address, f.status::text AS status,
          COALESCE(s.points, 0)::int AS points, COALESCE(s.duels, 0)::int AS duels, COALESCE(s.wins, 0)::int AS wins,
          (SELECT count(*) FROM picks p WHERE p.season_id = ${seasonId} AND p.fighter_address = f.address)::int AS backers,
          (SELECT avg(CASE WHEN w.winner = w.fighter_address THEN 1.0 ELSE 0.0 END)::float8 FROM (
            SELECT d.winner, d.fighter_address FROM duels d
            WHERE d.fighter_address = f.address AND d.counted AND d.status IN ('FINISHED', 'FORFEITED')
            ORDER BY d.id DESC LIMIT ${CONSISTENCY_WINDOW}
          ) w) AS consistency
        FROM fighters f
        LEFT JOIN fighter_season_scores s ON s.fighter_address = f.address AND s.season_id = ${seasonId}
        WHERE f.status <> 'INACTIVE' AND ${searchWhere}
      ), scored AS (SELECT *, (${SORT_EXPR[query.sort]})::float8 AS sortv FROM base)
      SELECT * FROM scored WHERE ${cursorWhere} ORDER BY sortv DESC, address ASC LIMIT ${limit + 1}`;

    const page = toPage(rows, limit, (last) => ({ v: last.sortv, a: last.address }));
    return {
      items: page.items.map((r) => ({
        address: r.address,
        status: r.status,
        points: r.points,
        duels: r.duels,
        wins: r.wins,
        consistency: r.consistency,
        backerCount: r.backers,
      })),
      nextCursor: page.nextCursor,
      season: season ? { id: season.id } : null,
      consistencyWindow: CONSISTENCY_WINDOW,
      sort: query.sort,
    };
  }

  async profile(address: string) {
    const fighter = await this.prisma.fighter.findUnique({ where: { address } });
    if (!fighter) throw notFound('Fighter not found');

    const [scores, season, freshness] = await Promise.all([
      this.prisma.fighterSeasonScore.findMany({
        where: { fighterAddress: address },
        orderBy: { seasonId: 'desc' },
      }),
      this.seasons.current(),
      this.freshness.get(),
    ]);
    const backerCount = season
      ? await this.prisma.pick.count({ where: { seasonId: season.id, fighterAddress: address } })
      : 0;

    return {
      address: fighter.address,
      status: fighter.status,
      seasons: scores.map((s) => ({
        seasonId: s.seasonId,
        points: s.points,
        duels: s.duels,
        wins: s.wins,
        reachedAt: s.reachedAt,
      })),
      totals: {
        points: scores.reduce((sum, s) => sum + s.points, 0),
        duels: scores.reduce((sum, s) => sum + s.duels, 0),
        wins: scores.reduce((sum, s) => sum + s.wins, 0),
      },
      backerCount,
      recentDuels: [],
      ...freshness,
    };
  }

  /** Duels that ended, newest first. `outcome` is from the fighter's side. */
  async history(address: string, limit: number, cursor: string | undefined) {
    const fighter = await this.prisma.fighter.findUnique({
      where: { address },
      select: { address: true },
    });
    if (!fighter) throw notFound('Fighter not found');
    const after = cursor ? this.parseIdCursor(cursor) : null;

    const rows = await this.prisma.duel.findMany({
      where: {
        fighterAddress: address,
        status: { in: [DuelStatus.FINISHED, DuelStatus.FORFEITED, DuelStatus.VOIDED] },
        ...(after ? { id: { lt: after } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: { bot: { select: { level: true } } },
    });
    const page = toPage(rows, limit, (last) => ({ id: last.id.toString() }));
    return {
      items: page.items.map((d) => ({
        id: d.id.toString(),
        assetId: d.assetId,
        botLevel: d.bot.level,
        status: d.status,
        outcome:
          d.status === DuelStatus.VOIDED
            ? ('void' as const)
            : d.winner === null
              ? ('draw' as const)
              : d.winner === address
                ? ('win' as const)
                : ('loss' as const),
        pointsAwarded: d.pointsAwarded,
        counted: d.counted,
        startAt: d.startAt,
        endAt: d.endAt,
      })),
      nextCursor: page.nextCursor,
    };
  }

  private parseCursor(cursor: string): { v: number; a: string } {
    const c = decodeCursor<{ v?: unknown; a?: unknown }>(cursor);
    if (typeof c.v !== 'number' || typeof c.a !== 'string') throw badRequest('Invalid cursor');
    return { v: c.v, a: c.a };
  }

  private parseIdCursor(cursor: string): bigint {
    const c = decodeCursor<{ id?: unknown }>(cursor);
    if (typeof c.id !== 'string' || !/^\d+$/.test(c.id)) throw badRequest('Invalid cursor');
    return BigInt(c.id);
  }
}
