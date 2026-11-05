import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface RankedRow {
  rank: number;
  address: string;
  points: number;
  wins: number;
  duels: number;
}

export interface UnrankedRow {
  address: string;
  points: number;
  duels: number;
}

/** The season ranking rule, in one place: score, then wins, then who reached the score first. */
@Injectable()
export class ScoreboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ranked fighters (at least `minDuels` duels), best first, starting after rank `afterRank`. */
  ranked(
    seasonId: number,
    minDuels: number,
    afterRank: number,
    limit: number,
  ): Promise<RankedRow[]> {
    return this.prisma.$queryRaw<RankedRow[]>`
      WITH ranked AS (
        SELECT s.fighter_address AS address, s.points, s.wins, s.duels,
          row_number() OVER (ORDER BY s.points DESC, s.wins DESC, s.reached_at ASC NULLS LAST, s.fighter_address ASC)::int AS rank
        FROM fighter_season_scores s
        JOIN fighters f ON f.address = s.fighter_address
        WHERE s.season_id = ${seasonId} AND s.duels >= ${minDuels} AND f.status <> 'INACTIVE'
      )
      SELECT rank, address, points, wins, duels FROM ranked WHERE rank > ${afterRank} ORDER BY rank LIMIT ${limit}`;
  }

  /** Fighters who have played but not enough duels yet: shown apart, never dropped. */
  unranked(seasonId: number, minDuels: number, limit: number): Promise<UnrankedRow[]> {
    return this.prisma.$queryRaw<UnrankedRow[]>`
      SELECT s.fighter_address AS address, s.points, s.duels
      FROM fighter_season_scores s
      JOIN fighters f ON f.address = s.fighter_address
      WHERE s.season_id = ${seasonId} AND s.duels < ${minDuels} AND f.status <> 'INACTIVE'
      ORDER BY s.duels DESC, s.points DESC, s.fighter_address ASC
      LIMIT ${limit}`;
  }

  async rankOf(seasonId: number, minDuels: number, address: string): Promise<RankedRow | null> {
    const rows = await this.prisma.$queryRaw<RankedRow[]>`
      WITH ranked AS (
        SELECT s.fighter_address AS address, s.points, s.wins, s.duels,
          row_number() OVER (ORDER BY s.points DESC, s.wins DESC, s.reached_at ASC NULLS LAST, s.fighter_address ASC)::int AS rank
        FROM fighter_season_scores s
        JOIN fighters f ON f.address = s.fighter_address
        WHERE s.season_id = ${seasonId} AND s.duels >= ${minDuels} AND f.status <> 'INACTIVE'
      )
      SELECT rank, address, points, wins, duels FROM ranked WHERE address = ${address}`;
    return rows[0] ?? null;
  }

  /** The fighter holding `rank`, if there is one. */
  async holderAt(seasonId: number, minDuels: number, rank: number): Promise<RankedRow | null> {
    const rows = await this.ranked(seasonId, minDuels, rank - 1, 1);
    return rows[0] ?? null;
  }

  async rankedCount(seasonId: number, minDuels: number): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM fighter_season_scores s
      JOIN fighters f ON f.address = s.fighter_address
      WHERE s.season_id = ${seasonId} AND s.duels >= ${minDuels} AND f.status <> 'INACTIVE'`;
    return row?.count ?? 0;
  }

  /** Points and duels of one fighter in a season, even when still unranked. */
  async scoreOf(seasonId: number, address: string) {
    return this.prisma.fighterSeasonScore.findUnique({
      where: { seasonId_fighterAddress: { seasonId, fighterAddress: address } },
    });
  }
}
