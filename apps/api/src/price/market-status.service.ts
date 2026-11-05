import { Injectable } from '@nestjs/common';
import type { MarketView } from '@hairto-arena/shared';
import { ParamsService } from '../config/params.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { resolveActiveAsset, type ArenaConfig } from './arena-calendar.js';
import { MARKETS, marketById, nextSessionChange, sessionOpen, type Market } from './markets.js';
import { ORACLE_KEYS, type QuoteState } from './oracle-keys.js';

/**
 * Open/closed per market for the API process. A market is open when
 * an enabled arena trades it, the market is in session, its feed was verified and its display quote is fresh.
 */
@Injectable()
export class MarketStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly params: ParamsService,
  ) {}

  async list(now = new Date()): Promise<MarketView[]> {
    return this.views(MARKETS, now);
  }

  /** The view of one market, or null when the asset id is not a market. */
  async get(assetId: number, now = new Date()): Promise<MarketView | null> {
    const market = marketById(assetId);
    return market ? (await this.views([market], now))[0]! : null;
  }

  private async views(markets: readonly Market[], now: Date): Promise<MarketView[]> {
    const [arenas, unverified, quotes] = await Promise.all([
      this.prisma.arena.findMany({ where: { active: true } }) as Promise<ArenaConfig[]>,
      this.redis.client.smembers(ORACLE_KEYS.unverifiedFeeds),
      this.redis.client.mget(markets.map((m) => ORACLE_KEYS.quoteLatest(m.assetId))),
    ]);
    const nowMs = now.getTime();

    return markets.map((market, i) => {
      const quote = quotes[i] ? (JSON.parse(quotes[i]) as QuoteState) : null;
      const arenaOpen = arenas.some(
        (a) => a.assetId === market.assetId && resolveActiveAsset(a, now).status === 'open',
      );
      const enabled =
        arenas.some((a) => a.assetId === market.assetId) &&
        !unverified.includes(String(market.assetId));

      let closedReason: MarketView['closedReason'] = null;
      if (!enabled) closedReason = 'disabled';
      else if (!sessionOpen(market, now) || !arenaOpen) closedReason = 'session';
      else if (!quote || nowMs - quote.publishMs > this.params.oracle.maxStalenessMs)
        closedReason = 'stale';

      return {
        assetId: market.assetId,
        symbol: market.symbol,
        open: closedReason === null,
        closedReason,
        lastPrice: quote?.price ?? null,
        lastPublishMs: quote?.publishMs ?? null,
        nextChangeAt: nextSessionChange(market, now),
      };
    });
  }
}
