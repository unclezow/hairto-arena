/**
 * Tradable markets. Asset ids must match the arena's (`add_asset`); feed ids are verified Pyth Hermes ids as 64
 * lowercase hex characters, the form the arena takes. All three trade 24/7 at the default source (Hyperliquid); a market's session, when set, is computed
 * here in its own time zone (see `xauSessionOpen`).
 */
export interface Market {
  assetId: number;
  symbol: string;
  /** Pyth feed id: the market's identity in the arena and `asset_feeds`, and the key for Hermes and the mock. */
  feedId: string;
  /** Market name on Hyperliquid (HIP-3 markets carry their dex prefix, e.g. `xyz:GOOGL`). */
  hyperliquidCoin: string;
  /** Null means the market never closes. */
  session: ((now: Date) => boolean) | null;
}

const NY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Weekday (0 = Sunday) and minute of day in New York. */
export function newYorkClock(now: Date): { day: number; minute: number } {
  const parts = Object.fromEntries(NY.formatToParts(now).map((p) => [p.type, p.value]));
  // The New York calendar date, read back as a UTC date, gives the New York weekday.
  const day = new Date(
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)),
  ).getUTCDay();
  return { day, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

const FIVE_PM = 17 * 60;
const SIX_PM = 18 * 60;

/** Gold: Sunday 18:00 to Friday 17:00 New York, with a daily break 17:00-18:00. */
export function xauSessionOpen(now: Date): boolean {
  const { day, minute } = newYorkClock(now);
  if (day === 6) return false;
  if (day === 0) return minute >= SIX_PM;
  if (day === 5) return minute < FIVE_PM;
  return minute < FIVE_PM || minute >= SIX_PM;
}

export const MARKETS: readonly Market[] = [
  {
    assetId: 1,
    symbol: 'GOOGL',
    feedId: 'ad519718d387de4f0d7d29ea16a3730ce42e49c59fef6fba6fc9bac477645f6f',
    hyperliquidCoin: 'xyz:GOOGL',
    session: null,
  },
  {
    assetId: 2,
    symbol: 'BTC',
    feedId: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
    hyperliquidCoin: 'BTC',
    session: null,
  },
  {
    assetId: 3,
    symbol: 'XAU',
    feedId: '765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2',
    hyperliquidCoin: 'xyz:GOLD',
    // 24/7: the price source (Hyperliquid) trades gold around the clock. `xauSessionOpen` stays for a
    // session-bound source such as Pyth's XAU feed.
    session: null,
  },
];

export const marketById = (assetId: number) => MARKETS.find((m) => m.assetId === assetId);

export type PriceSource = 'mock' | 'pyth' | 'hyperliquid';
export const PRICE_SOURCE_NAMES: readonly PriceSource[] = ['mock', 'pyth', 'hyperliquid'];

/** How `source` names this market. */
export const priceKey = (market: Market, source: PriceSource) =>
  source === 'hyperliquid' ? market.hyperliquidCoin : market.feedId;

/** Feed id (lowercase) -> Hyperliquid coin, for the Hyperliquid provider. */
export const hyperliquidCoins = () =>
  Object.fromEntries(MARKETS.map((m) => [m.feedId.toLowerCase(), m.hyperliquidCoin]));

/**
 * Sources per market, in order of preference, from `PRICE_SOURCES` (e.g. `GOOGL=hyperliquid;BTC=pyth,hyperliquid`).
 * Markets it does not name use `fallback`. Throws on an unknown symbol or source, so a typo fails at boot.
 */
export function parsePriceSources(
  spec: string | undefined,
  fallback: PriceSource,
): Map<number, PriceSource[]> {
  const plan = new Map<number, PriceSource[]>(MARKETS.map((m) => [m.assetId, [fallback]]));
  for (const entry of (spec ?? '')
    .split(';')
    .map((e) => e.trim())
    .filter(Boolean)) {
    const [symbol, list] = entry.split('=').map((s) => s?.trim());
    const market = MARKETS.find((m) => m.symbol === symbol?.toUpperCase());
    if (!market || !list) throw new Error(`PRICE_SOURCES: unknown market in "${entry}"`);
    const sources = list.split(',').map((s) => s.trim()) as PriceSource[];
    for (const s of sources)
      if (!PRICE_SOURCE_NAMES.includes(s)) throw new Error(`PRICE_SOURCES: unknown source "${s}"`);
    plan.set(market.assetId, sources);
  }
  return plan;
}

export function sessionOpen(market: Market, now: Date): boolean {
  return market.session === null || market.session(now);
}

const STEP_MS = 15 * 60_000;
const HORIZON_MS = 8 * 86_400_000;

/** Unix ms of the next open/close flip, at 15-minute resolution; null for always-open markets. */
export function nextSessionChange(market: Market, now: Date): number | null {
  if (market.session === null) return null;
  const current = market.session(now);
  const start = Math.ceil(now.getTime() / STEP_MS) * STEP_MS;
  for (let t = start; t - now.getTime() <= HORIZON_MS; t += STEP_MS) {
    if (market.session(new Date(t)) !== current) return t;
  }
  return null;
}
