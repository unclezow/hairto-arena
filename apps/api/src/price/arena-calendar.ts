import { marketById, sessionOpen } from './markets.js';

/**
 * Arena sessions are a pure function of configuration and a timestamp.
 * A closed arena stays closed: there is no rotation to another asset.
 */

export interface ArenaConfig {
  id: number;
  name: string;
  assetId: number;
  /** Kept for admin compatibility; ignored since rotation was removed. */
  fallbackAssetId: number | null;
  /** Minutes since UTC midnight. Both null means always open. end < start wraps past midnight. */
  sessionStartMin: number | null;
  sessionEndMin: number | null;
  /** Bit n set = open on UTC weekday n (0 = Sunday). */
  weekdayMask: number;
  active: boolean;
}

export type ArenaResolution = { status: 'open'; assetId: number } | { status: 'closed' };

const MINUTES_PER_DAY = 24 * 60;

function dayOpen(mask: number, utcDay: number) {
  return (mask & (1 << utcDay)) !== 0;
}

/** Is the arena's primary asset inside its session at `now`? */
export function isSessionOpen(arena: ArenaConfig, now: Date): boolean {
  const day = now.getUTCDay();
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  const { sessionStartMin: start, sessionEndMin: end } = arena;

  if (start === null || end === null) return dayOpen(arena.weekdayMask, day);
  if (start === end) return dayOpen(arena.weekdayMask, day);
  if (start < end) return dayOpen(arena.weekdayMask, day) && minute >= start && minute < end;

  // Wraps past midnight: the late part belongs to the day the session started, the early part to the next.
  if (minute >= start) return dayOpen(arena.weekdayMask, day);
  const previousDay = (day + 6) % 7;
  return minute < end && dayOpen(arena.weekdayMask, previousDay);
}

/**
 * Whether the arena trades its asset at `now`: the arena is enabled, inside its own window, and the market itself
 * is in session (XAU follows New York hours, see markets.ts).
 */
export function resolveActiveAsset(arena: ArenaConfig, now: Date): ArenaResolution {
  if (!arena.active || !isSessionOpen(arena, now)) return { status: 'closed' };
  const market = marketById(arena.assetId);
  if (market && !sessionOpen(market, now)) return { status: 'closed' };
  return { status: 'open', assetId: arena.assetId };
}

export { MINUTES_PER_DAY };
