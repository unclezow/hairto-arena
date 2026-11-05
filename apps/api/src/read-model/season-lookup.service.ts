import { Injectable } from '@nestjs/common';
import { badRequest, notFound } from '../common/errors.js';
import { ParamsService } from '../config/params.service.js';
import type { Season } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { seasonPhase, seasonTimers, type SeasonPhase } from './season-clock.js';

@Injectable()
export class SeasonLookup {
  constructor(
    private readonly prisma: PrismaService,
    private readonly params: ParamsService,
  ) {}

  /** The season that started most recently, or null before the first one. */
  current(now = new Date()): Promise<Season | null> {
    return this.prisma.season.findFirst({
      where: { startAt: { lte: now } },
      orderBy: { startAt: 'desc' },
    });
  }

  /** `current` (or nothing) means the running season; a number means that season. Null if it does not exist. */
  async resolve(param: string | undefined, now = new Date()): Promise<Season | null> {
    if (param === undefined || param === 'current') return this.current(now);
    if (!/^\d{1,9}$/.test(param))
      throw badRequest('Invalid season', [
        { path: 'season', message: 'must be a number or "current"' },
      ]);
    return this.prisma.season.findUnique({ where: { id: Number(param) } });
  }

  async require(param: string | undefined, now = new Date()): Promise<Season> {
    const season = await this.resolve(param, now);
    if (!season)
      throw notFound(
        param && param !== 'current' ? 'Season not found' : 'No season has started yet',
      );
    return season;
  }

  windows() {
    return {
      pickWindowMs: this.params.season.pickWindowMs,
      disputeWindowMs: this.params.season.disputeWindowMs,
    };
  }

  phaseOf(season: Season, now = new Date()): SeasonPhase {
    return seasonPhase(season, now, this.windows());
  }

  timersOf(season: Season) {
    return seasonTimers(season, this.windows());
  }
}
