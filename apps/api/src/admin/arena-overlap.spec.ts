import { describe, expect, it } from 'vitest';
import type { ArenaConfig } from '../price/arena-calendar.js';
import { sessionsOverlap } from './arena-overlap.js';

const arena = (over: Partial<ArenaConfig>): ArenaConfig => ({
  id: 1,
  name: 'a',
  assetId: 1,
  fallbackAssetId: null,
  sessionStartMin: null,
  sessionEndMin: null,
  weekdayMask: 127,
  active: true,
  ...over,
});

describe('sessionsOverlap', () => {
  it('two always-open arenas overlap', () => {
    expect(sessionsOverlap(arena({}), arena({}))).toBe(true);
  });

  it('back to back sessions on the same days do not overlap', () => {
    const am = arena({ sessionStartMin: 0, sessionEndMin: 720 });
    const pm = arena({ sessionStartMin: 720, sessionEndMin: 1380 });
    expect(sessionsOverlap(am, pm)).toBe(false);
  });

  it('different weekdays do not overlap even in the same hours', () => {
    const weekdays = arena({ weekdayMask: 0b0111110 });
    const weekend = arena({ weekdayMask: 0b1000001 });
    expect(sessionsOverlap(weekdays, weekend)).toBe(false);
  });

  it('sees an overlap across midnight', () => {
    const night = arena({ sessionStartMin: 1320, sessionEndMin: 120 });
    const early = arena({ sessionStartMin: 60, sessionEndMin: 300 });
    expect(sessionsOverlap(night, early)).toBe(true);
  });

  it('a session that wraps past midnight carries into the next weekday', () => {
    const fridayNight = arena({ weekdayMask: 1 << 5, sessionStartMin: 1320, sessionEndMin: 120 });
    const saturdayMorning = arena({ weekdayMask: 1 << 6, sessionStartMin: 0, sessionEndMin: 60 });
    expect(sessionsOverlap(fridayNight, saturdayMorning)).toBe(true);
  });
});
