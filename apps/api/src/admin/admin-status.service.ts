import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { STUCK_SET } from '../duels/duel-settler.service.js';
import { RuntimeFlagsService } from '../flags/runtime-flags.service.js';
import { ORACLE_KEYS } from '../price/oracle-keys.js';
import { OracleStatusService } from '../price/oracle-status.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { INDEXER_LAG_KEY } from '../redis/keys.js';
import { RedisService } from '../redis/redis.service.js';

type Health = 'ok' | 'degraded' | 'down' | 'unknown';
const RANK: Record<Health, number> = { ok: 0, unknown: 1, degraded: 2, down: 3 };

export interface Component {
  status: Health;
  [key: string]: unknown;
}

/** One place to look at whether the backend is healthy; each part is measured on its own and may fail on its own. */
@Injectable()
export class AdminStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly flags: RuntimeFlagsService,
    private readonly oracle: OracleStatusService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async get() {
    const [keeper, price, bot, indexer, duels] = await Promise.all([
      this.part(() => this.keeper()),
      this.part(() => this.price()),
      this.part(() => this.bot()),
      this.part(() => this.indexer()),
      this.part(() => this.duels()),
    ]);
    const components = { keeper, price, bot, indexer, duels };
    const overall = Object.values(components).reduce<Health>(
      (worst, c) => (RANK[c.status] > RANK[worst] ? c.status : worst),
      'ok',
    );
    return { generatedAt: new Date(), status: overall, components };
  }

  private async part(measure: () => Promise<Component>): Promise<Component> {
    try {
      return await measure();
    } catch (err) {
      return { status: 'unknown', error: (err as Error).message };
    }
  }

  private async keeper(): Promise<Component> {
    const [enabled, dryRun, runs, harvest] = await Promise.all([
      this.flags.get('KEEPER_ENABLED'),
      this.flags.get('KEEPER_DRY_RUN'),
      this.prisma.seasonRun.findMany({ orderBy: { seasonId: 'desc' }, take: 5 }),
      this.prisma.harvest.findFirst({ orderBy: { timestamp: 'desc' } }),
    ]);
    const failing = runs.filter((r) => r.state !== 'finalized' && r.error);
    return {
      status: failing.length ? 'degraded' : 'ok',
      enabled,
      dryRun,
      seasons: runs.map((r) => ({
        seasonId: r.seasonId,
        state: r.state,
        error: r.error,
        updatedAt: r.updatedAt,
      })),
      lastHarvest: harvest ? { vault: harvest.vault, at: harvest.timestamp } : null,
    };
  }

  private async price(): Promise<Component> {
    const [entries, holder] = await Promise.all([
      this.oracle.snapshot(),
      this.redis.client.get(ORACLE_KEYS.pusherLock),
    ]);
    const verdicts = entries.map((e) => ({ assetId: e.assetId, status: e.status }));
    const status: Health = entries.some((e) => e.status === 'outage')
      ? 'down'
      : entries.some((e) => e.status !== 'ok') || holder === null
        ? 'degraded'
        : 'ok';
    return {
      status: entries.length === 0 && holder === null ? 'unknown' : status,
      source: this.config.get('PRICE_SOURCE', { infer: true }),
      pusherLockHolder: holder,
      assets: verdicts,
    };
  }

  private async bot(): Promise<Component> {
    const [bots, running, unrevealed, pending] = await Promise.all([
      this.prisma.bot.findMany({ select: { id: true, level: true, active: true } }),
      this.prisma.duel.count({ where: { status: { in: ['CREATED', 'ACTIVE'] } } }),
      this.prisma.botSeed.count({ where: { unrevealedAt: { not: null } } }),
      this.prisma.pendingTicket.count(),
    ]);
    const levelsWithoutBot = [1, 2, 3].filter((l) => !bots.some((b) => b.level === l && b.active));
    return {
      status:
        bots.length === 0 ? 'unknown' : levelsWithoutBot.length || unrevealed ? 'degraded' : 'ok',
      activeBots: bots.filter((b) => b.active).length,
      levelsWithoutBot,
      runningDuels: running,
      unrevealedSeeds: unrevealed,
      pendingTickets: pending,
    };
  }

  private async indexer(): Promise<Component> {
    const raw = await this.redis.client.get(INDEXER_LAG_KEY);
    if (raw === null) return { status: 'unknown', lagBlocks: null };
    const lag = Number(raw);
    const limit = this.config.get('KEEPER_MAX_INDEXER_LAG_BLOCKS', { infer: true });
    return { status: lag > limit ? 'degraded' : 'ok', lagBlocks: lag, maxForKeeper: limit };
  }

  private async duels(): Promise<Component> {
    const stuck = await this.redis.client.scard(STUCK_SET);
    return { status: stuck > 0 ? 'degraded' : 'ok', stuck };
  }
}
