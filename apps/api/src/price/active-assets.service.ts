import { Injectable, Logger } from '@nestjs/common';
import { DuelStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { MARKETS } from './markets.js';
import { ORACLE_KEYS } from './oracle-keys.js';

export interface ActiveAsset {
  assetId: number;
  /** 64 hex characters. */
  feedId: string;
}

@Injectable()
export class ActiveAssetsService {
  private readonly logger = new Logger(ActiveAssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Assets that need on-chain ticks right now: a seed ticket was just requested on
   * them (demand key in Redis) or a duel on them is not terminal yet. Idle markets get nothing.
   */
  async resolve(_now: Date = new Date()): Promise<ActiveAsset[]> {
    const [demand, running] = await Promise.all([
      this.redis.client.mget(MARKETS.map((m) => ORACLE_KEYS.demand(m.assetId))),
      this.prisma.duel.findMany({
        where: { status: { in: [DuelStatus.CREATED, DuelStatus.ACTIVE] } },
        select: { assetId: true },
        distinct: ['assetId'],
      }),
    ]);

    const demanded = new Set(running.map((d) => d.assetId));
    MARKETS.forEach((m, i) => {
      if (demand[i] !== null) demanded.add(m.assetId);
    });
    const ids = [...demanded].sort((a, b) => a - b);
    if (ids.length === 0) return [];

    const feeds = await this.prisma.assetFeed.findMany({ where: { assetId: { in: ids } } });
    const byId = new Map(feeds.map((f) => [f.assetId, f]));
    const out: ActiveAsset[] = [];
    for (const assetId of ids) {
      const feed = byId.get(assetId);
      if (!feed) {
        this.logger.warn(`Asset ${assetId} has no feed configured, skipping`);
        continue;
      }
      out.push({ assetId, feedId: feed.feedId.replace(/^0x/i, '').toLowerCase() });
    }
    return out;
  }

  /** Duels still running on an asset, for void signals. */
  runningDuelIds(assetId: number): Promise<bigint[]> {
    return this.prisma.duel
      .findMany({
        where: { assetId, status: { in: [DuelStatus.CREATED, DuelStatus.ACTIVE] } },
        select: { id: true },
      })
      .then((rows) => rows.map((r) => r.id));
  }
}
