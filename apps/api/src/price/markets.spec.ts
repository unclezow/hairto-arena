import {
  MARKETS,
  marketById,
  newYorkClock,
  nextSessionChange,
  priceKey,
  xauSessionOpen,
  type Market,
} from './markets.js';

const at = (iso: string) => new Date(iso);

describe('newYorkClock', () => {
  it('follows daylight saving time', () => {
    // 2026-07-15 is EDT (UTC-4), 2026-12-16 is EST (UTC-5); both Wednesdays.
    expect(newYorkClock(at('2026-07-15T16:00:00Z'))).toEqual({ day: 3, minute: 12 * 60 });
    expect(newYorkClock(at('2026-12-16T16:00:00Z'))).toEqual({ day: 3, minute: 11 * 60 });
  });
});

describe('xauSessionOpen', () => {
  it('is closed on Saturday and before the Sunday 18:00 open', () => {
    expect(xauSessionOpen(at('2026-10-24T15:00:00Z'))).toBe(false); // Sat 11:00 NY
    expect(xauSessionOpen(at('2026-10-25T21:59:00Z'))).toBe(false); // Sun 17:59 NY (EDT)
    expect(xauSessionOpen(at('2026-10-25T22:00:00Z'))).toBe(true); // Sun 18:00 NY
  });

  it('closes on Friday at 17:00 New York time', () => {
    expect(xauSessionOpen(at('2026-10-23T20:59:00Z'))).toBe(true); // Fri 16:59 NY
    expect(xauSessionOpen(at('2026-10-23T21:00:00Z'))).toBe(false); // Fri 17:00 NY
  });

  it('takes a daily break 17:00-18:00, shifted by DST', () => {
    expect(xauSessionOpen(at('2026-07-15T21:30:00Z'))).toBe(false); // Wed 17:30 EDT
    expect(xauSessionOpen(at('2026-07-15T22:00:00Z'))).toBe(true); // Wed 18:00 EDT
    expect(xauSessionOpen(at('2026-12-16T21:30:00Z'))).toBe(true); // Wed 16:30 EST
    expect(xauSessionOpen(at('2026-12-16T22:30:00Z'))).toBe(false); // Wed 17:30 EST
  });
});

describe('MARKETS', () => {
  it('lists GOOGL, BTC and XAU with distinct ids and feeds', () => {
    expect(MARKETS.map((m) => [m.assetId, m.symbol])).toEqual([
      [1, 'GOOGL'],
      [2, 'BTC'],
      [3, 'XAU'],
    ]);
    expect(new Set(MARKETS.map((m) => m.feedId)).size).toBe(3);
  });

  it('keeps every market open 24/7 at the default source', () => {
    for (const m of MARKETS) expect(m.session).toBeNull();
    expect(nextSessionChange(marketById(3)!, at('2026-10-24T15:00:00Z'))).toBeNull();
  });

  it('names each market per source', () => {
    expect(MARKETS.map((m) => priceKey(m, 'hyperliquid'))).toEqual([
      'xyz:GOOGL',
      'BTC',
      'xyz:GOLD',
    ]);
    expect(priceKey(marketById(2)!, 'pyth')).toBe(marketById(2)!.feedId);
    expect(priceKey(marketById(2)!, 'mock')).toBe(marketById(2)!.feedId);
  });
});

/** A session-bound gold market, as with Pyth's XAU feed. */
const sessionGold: Market = { ...MARKETS[2]!, session: xauSessionOpen };

describe('nextSessionChange', () => {
  it('finds the Sunday open for XAU on a Saturday', () => {
    expect(nextSessionChange(sessionGold, at('2026-10-24T15:00:00Z'))).toBe(
      Date.parse('2026-10-25T22:00:00Z'),
    );
  });

  it('finds the daily break for XAU midweek', () => {
    expect(nextSessionChange(sessionGold, at('2026-10-21T15:07:00Z'))).toBe(
      Date.parse('2026-10-21T21:00:00Z'),
    );
  });
});
