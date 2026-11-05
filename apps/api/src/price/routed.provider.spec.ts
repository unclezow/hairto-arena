import { describe, expect, it } from 'vitest';
import { MARKETS, parsePriceSources } from './markets.js';
import type { PriceProvider, RawPrice } from './price-provider.js';
import { RoutedPriceProvider } from './routed.provider.js';

const NOW = 1_800_000_000_000;
/** `age` in seconds. */
const price = (value: bigint, age: number): RawPrice => ({
  price: value,
  expo: -8,
  publishMs: NOW - age * 1000,
});

class Fixed implements PriceProvider {
  asked: string[][] = [];
  fail = false;
  constructor(private readonly table: Record<string, RawPrice>) {}
  async prices(ids: string[]) {
    this.asked.push(ids);
    if (this.fail) throw new Error('HTTP 403');
    return new Map(ids.flatMap((id) => (this.table[id] ? [[id, this.table[id]!] as const] : [])));
  }
}

function router(routes: Record<string, PriceProvider[]>, names: [PriceProvider, string][]) {
  return new RoutedPriceProvider(new Map(Object.entries(routes)), 5_000, new Map(names), () => NOW);
}

describe('RoutedPriceProvider', () => {
  it('asks each source only for the markets routed to it', async () => {
    const pyth = new Fixed({ btc: price(1n, 0), xau: price(2n, 0) });
    const hl = new Fixed({ googl: price(3n, 0), btc: price(9n, 0), xau: price(9n, 0) });
    const r = router({ googl: [hl], btc: [pyth, hl], xau: [pyth, hl] }, [
      [pyth, 'pyth'],
      [hl, 'hyperliquid'],
    ]);
    const out = await r.prices(['googl', 'btc', 'xau']);
    expect(pyth.asked).toEqual([['btc', 'xau']]);
    expect([...out].map(([id, p]) => [id, p.price])).toEqual([
      ['googl', 3n],
      ['btc', 1n],
      ['xau', 2n],
    ]);
  });

  it('falls back when the preferred price is stale or the source fails', async () => {
    const pyth = new Fixed({ xau: price(2n, 60) }); // gold hours closed: last price a minute old
    const hl = new Fixed({ xau: price(9n, 0), btc: price(8n, 1) });
    const r = router({ xau: [pyth, hl], btc: [pyth, hl] }, [
      [pyth, 'pyth'],
      [hl, 'hyperliquid'],
    ]);
    expect((await r.prices(['xau'])).get('xau')!.price).toBe(9n);
    pyth.fail = true; // expired key
    expect((await r.prices(['btc'])).get('btc')!.price).toBe(8n);
  });

  it('returns the newest price when no source is fresh, so staleness still shows', async () => {
    const a = new Fixed({ btc: price(1n, 30) });
    const b = new Fixed({ btc: price(2n, 20) });
    const r = router({ btc: [a, b] }, [
      [a, 'a'],
      [b, 'b'],
    ]);
    expect((await r.prices(['btc'])).get('btc')!.price).toBe(2n);
  });
});

describe('parsePriceSources', () => {
  it('overrides the named markets and keeps the fallback for the rest', () => {
    const plan = parsePriceSources('GOOGL=hyperliquid; btc = pyth,hyperliquid', 'mock');
    const by = (symbol: string) => plan.get(MARKETS.find((m) => m.symbol === symbol)!.assetId);
    expect(by('GOOGL')).toEqual(['hyperliquid']);
    expect(by('BTC')).toEqual(['pyth', 'hyperliquid']);
    expect(by('XAU')).toEqual(['mock']);
  });

  it('rejects unknown markets and sources', () => {
    expect(() => parsePriceSources('DOGE=pyth', 'mock')).toThrow(/unknown market/);
    expect(() => parsePriceSources('BTC=chainlink', 'mock')).toThrow(/unknown source/);
  });
});
