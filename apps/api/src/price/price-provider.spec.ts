import { MockPriceProvider } from './price-provider.js';

const FEED = '11'.repeat(32);
const OTHER = '22'.repeat(32);
const options = {
  seed: 'ab'.repeat(32),
  basePrice: 100,
  volatilityBps: 5,
  startMs: 1_800_000_000_000,
};

async function series(provider: MockPriceProvider, feed: string, n: number) {
  const out: bigint[] = [];
  for (let i = 0; i < n; i++) out.push((await provider.prices([feed])).get(feed)!.price);
  return out;
}

describe('MockPriceProvider', () => {
  it('produces the identical series for the same seed and start time', async () => {
    expect(await series(new MockPriceProvider(options), FEED, 50)).toEqual(
      await series(new MockPriceProvider(options), FEED, 50),
    );
  });

  it('produces a different series for a different seed or feed', async () => {
    const base = await series(new MockPriceProvider(options), FEED, 20);
    expect(
      await series(new MockPriceProvider({ ...options, seed: 'cd'.repeat(32) }), FEED, 20),
    ).not.toEqual(base);
    expect(await series(new MockPriceProvider(options), OTHER, 20)).not.toEqual(base);
  });

  it('moves a little per tick and stays positive', async () => {
    const prices = await series(new MockPriceProvider(options), FEED, 500);
    expect(prices.every((p) => p > 0n)).toBe(true);
    for (let i = 1; i < prices.length; i++) {
      const move = Math.abs(Number(prices[i]! - prices[i - 1]!)) / Number(prices[i - 1]!);
      expect(move).toBeLessThan(0.01); // 100 bps is 20 standard deviations away
    }
  });

  it('reports exponent -8 and a publish time that advances one second per step', async () => {
    const provider = new MockPriceProvider(options);
    const first = (await provider.prices([FEED])).get(FEED)!;
    const second = (await provider.prices([FEED])).get(FEED)!;
    expect(first.expo).toBe(-8);
    expect(first.publishMs).toBe(1_800_000_001_000);
    expect(second.publishMs).toBe(1_800_000_002_000);
  });

  it('returns every requested feed in one call', async () => {
    const result = await new MockPriceProvider(options).prices([FEED, OTHER]);
    expect([...result.keys()]).toEqual([FEED, OTHER]);
  });
});
