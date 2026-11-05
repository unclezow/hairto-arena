import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WS_EVENTS, type QuoteEvent } from '@hairto-arena/shared';
import { toDecimalString } from '../common/decimal.js';
import type { Env } from '../config/env.js';
import { CHANNELS } from '../realtime/channels.js';
import { RedisService } from '../redis/redis.service.js';
import { MARKETS, type Market } from './markets.js';
import { ORACLE_KEYS, type QuoteState } from './oracle-keys.js';
import { PRICE_PROVIDER } from './price.tokens.js';
import type { PriceProvider, RawPrice } from './price-provider.js';

/** About ten minutes of quotes per market at one per second. */
const QUOTE_STREAM_MAX_LEN = 600;
const QUOTE_TTL_SEC = 60;

/**
 * Display prices for every market, straight from the provider, with no chain transaction. It is the only
 * consumer of the provider; the pusher writes on-chain from `latest()`.
 */
@Injectable()
export class QuoteService implements OnModuleInit {
  private readonly logger = new Logger(QuoteService.name);
  private readonly quotes = new Map<number, RawPrice>();
  private markets: readonly Market[] = MARKETS;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService<Env, true>,
    @Inject(PRICE_PROVIDER) private readonly provider: PriceProvider,
  ) {}

  /** Every source is asked by feed id, the market's identity; each provider maps it to its own naming. */
  private key(market: Market) {
    return market.feedId;
  }

  async onModuleInit() {
    if (!this.config.get('PRICE_PUSHER_ENABLED', { infer: true })) return;
    await this.verifyFeeds().catch((err: Error) =>
      this.logger.warn(`Could not verify markets against the price source: ${err.message}`),
    );
  }

  /** Markets the price source does not list are dropped and reported closed. */
  async verifyFeeds() {
    if (!this.provider.knownKeys) return;
    const known = await this.provider.knownKeys(MARKETS.map((m) => this.key(m)));
    const unknown = MARKETS.filter((m) => !known.has(this.key(m)));
    for (const m of unknown) {
      this.logger.error(`${m.symbol} is not listed by any of its price sources; market closed`);
    }
    this.markets = MARKETS.filter((m) => !unknown.includes(m));
    const multi = this.redis.client.multi().del(ORACLE_KEYS.unverifiedFeeds);
    if (unknown.length > 0)
      multi.sadd(ORACLE_KEYS.unverifiedFeeds, ...unknown.map((m) => m.assetId));
    await multi.exec();
  }

  /** The latest quote of a market in this process, if any. */
  latest(assetId: number): RawPrice | undefined {
    return this.quotes.get(assetId);
  }

  /** Pulls a price for every market and publishes the ones that moved forward. */
  async refresh(): Promise<QuoteEvent[]> {
    if (this.markets.length === 0) return [];
    const prices = await this.provider.prices(this.markets.map((m) => this.key(m)));
    const published: QuoteEvent[] = [];

    for (const market of this.markets) {
      const next = prices.get(this.key(market));
      const current = this.quotes.get(market.assetId);
      if (!next || (current && next.publishMs <= current.publishMs)) continue;
      this.quotes.set(market.assetId, next);

      const price = toDecimalString(next.price, next.expo);
      const event: QuoteEvent = {
        assetId: market.assetId,
        price,
        expo: next.expo,
        publishMs: next.publishMs,
      };
      const state: QuoteState = {
        price,
        mantissa: next.price.toString(),
        expo: next.expo,
        publishMs: next.publishMs,
      };
      await this.redis.client
        .multi()
        .set(ORACLE_KEYS.quoteLatest(market.assetId), JSON.stringify(state), 'EX', QUOTE_TTL_SEC)
        .xadd(
          ORACLE_KEYS.quoteStream(market.assetId),
          'MAXLEN',
          '~',
          QUOTE_STREAM_MAX_LEN,
          '*',
          'price',
          price,
          'publishMs',
          String(next.publishMs),
        )
        .publish(
          CHANNELS.price(market.assetId),
          JSON.stringify({ event: WS_EVENTS.quote, data: event }),
        )
        .exec()
        .catch((err: Error) => this.logger.warn(`Could not publish quote: ${err.message}`));
      published.push(event);
    }
    return published;
  }
}
