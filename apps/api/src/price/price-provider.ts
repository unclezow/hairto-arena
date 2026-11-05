import { seededRandom } from '../bot/seed.js';

/** A price as the oracle reports it: `price * 10^expo`. */
export interface RawPrice {
  price: bigint;
  expo: number;
  /** Unix ms. */
  publishMs: number;
}

/**
 * A price source. Keys are whatever identifies a market at that source: a Pyth feed id for Hermes and the mock, a
 * coin name for Hyperliquid (see `priceKey` in markets.ts).
 */
export interface PriceProvider {
  prices(keys: string[]): Promise<Map<string, RawPrice>>;
  /** The subset of `keys` the source knows, for the startup check. Absent: every key is assumed known. */
  knownKeys?(keys: string[]): Promise<Set<string>>;
  close?(): void;
}

const EXPO = -8;
const SCALE = 10n ** 8n;

export interface MockPriceOptions {
  /** 64 hex characters (an optional 0x prefix is ignored). */
  seed: string;
  /** Price every feed starts from, in whole units. */
  basePrice: number;
  /** One standard deviation of the per-tick move, in basis points. */
  volatilityBps: number;
  /** Unix ms the series is anchored to; step n is published n seconds later. */
  startMs: number;
}

/**
 * Seeded random walk per feed. The n-th price of a feed depends only on (seed, feed, start time, n), so two
 * providers with the same options produce identical series.
 */
export class MockPriceProvider implements PriceProvider {
  private readonly state = new Map<string, { random: () => number; price: number; step: number }>();

  constructor(private readonly options: MockPriceOptions) {}

  async prices(feedIds: string[]): Promise<Map<string, RawPrice>> {
    const out = new Map<string, RawPrice>();
    for (const feedId of feedIds) {
      const s = this.stateFor(feedId);
      s.step += 1;
      // Box-Muller keeps the walk symmetric around zero.
      const u1 = Math.max(s.random(), Number.EPSILON);
      const u2 = s.random();
      const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      s.price = Math.max(0.01, s.price * (1 + (gaussian * this.options.volatilityBps) / 10_000));
      out.set(feedId, {
        price: BigInt(Math.round(s.price * Number(SCALE))),
        expo: EXPO,
        publishMs: this.options.startMs + s.step * 1000,
      });
    }
    return out;
  }

  private stateFor(feedId: string) {
    let s = this.state.get(feedId);
    if (!s) {
      // A different seed per feed, derived from the base seed and the feed id.
      const feedSeed = `${hex(this.options.seed).slice(0, 32)}${hex(feedId).slice(0, 32)}`;
      s = { random: seededRandom(feedSeed), price: this.options.basePrice, step: 0 };
      this.state.set(feedId, s);
    }
    return s;
  }
}

/** Lowercase hex without a 0x prefix. */
function hex(value: string): string {
  return value.replace(/^0x/i, '').toLowerCase();
}
