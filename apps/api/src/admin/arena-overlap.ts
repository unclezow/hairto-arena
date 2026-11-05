import { isSessionOpen, type ArenaConfig } from '../price/arena-calendar.js';

const MINUTES_PER_WEEK = 7 * 24 * 60;
// Sunday 2024-01-07 00:00 UTC: any week would do, the calendar only looks at weekday and minute.
const WEEK_START = Date.UTC(2024, 0, 7);

/** Every minute of the week the arena's primary asset is open, as indexes into the week. */
export function openMinutes(arena: ArenaConfig): Set<number> {
  const open = new Set<number>();
  for (let m = 0; m < MINUTES_PER_WEEK; m++) {
    if (isSessionOpen(arena, new Date(WEEK_START + m * 60_000))) open.add(m);
  }
  return open;
}

/** Do two arenas trade at the same time? Used for arenas that share an asset. */
export function sessionsOverlap(a: ArenaConfig, b: ArenaConfig): boolean {
  const first = openMinutes(a);
  for (const m of openMinutes(b)) if (first.has(m)) return true;
  return false;
}
