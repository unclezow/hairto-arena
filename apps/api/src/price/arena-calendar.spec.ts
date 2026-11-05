import { resolveActiveAsset, type ArenaConfig } from './arena-calendar.js';

const equity: ArenaConfig = {
  id: 1,
  name: 'Equity',
  assetId: 1,
  fallbackAssetId: 2,
  // A windowed arena in UTC: 14:30-21:00, Monday to Friday.
  sessionStartMin: 14 * 60 + 30,
  sessionEndMin: 21 * 60,
  weekdayMask: 0b0111110,
  active: true,
};

// 2026-10-21 is a Wednesday, 2026-10-24 a Saturday.
const at = (iso: string) => new Date(iso);

describe('resolveActiveAsset', () => {
  it('trades the primary asset inside the session', () => {
    expect(resolveActiveAsset(equity, at('2026-10-21T15:00:00Z'))).toEqual({
      status: 'open',
      assetId: 1,
    });
  });

  it('includes the start minute and excludes the end minute', () => {
    expect(resolveActiveAsset(equity, at('2026-10-21T14:30:00Z'))).toMatchObject({ assetId: 1 });
    expect(resolveActiveAsset(equity, at('2026-10-21T14:29:59Z')).status).toBe('closed');
    expect(resolveActiveAsset(equity, at('2026-10-21T20:59:59Z'))).toMatchObject({ assetId: 1 });
    expect(resolveActiveAsset(equity, at('2026-10-21T21:00:00Z')).status).toBe('closed');
  });

  it('is closed outside the session and on closed days, even with a fallback configured', () => {
    expect(resolveActiveAsset(equity, at('2026-10-21T03:00:00Z'))).toEqual({ status: 'closed' });
    expect(resolveActiveAsset(equity, at('2026-10-24T15:00:00Z'))).toEqual({ status: 'closed' });
  });

  it('is closed when the arena is disabled', () => {
    expect(resolveActiveAsset({ ...equity, active: false }, at('2026-10-21T15:00:00Z'))).toEqual({
      status: 'closed',
    });
  });

  it('is always open without a session window (24/7 asset)', () => {
    const gold: ArenaConfig = {
      ...equity,
      assetId: 2,
      fallbackAssetId: null,
      sessionStartMin: null,
      sessionEndMin: null,
      weekdayMask: 127,
    };
    expect(resolveActiveAsset(gold, at('2026-10-24T03:00:00Z'))).toMatchObject({ assetId: 2 });
    expect(resolveActiveAsset(gold, at('2026-10-21T21:00:00Z'))).toMatchObject({ assetId: 2 });
  });

  it('supports a session that wraps past midnight and belongs to the day it started', () => {
    // Opens 22:00 Friday, closes 06:00 Saturday.
    const overnight: ArenaConfig = {
      ...equity,
      fallbackAssetId: null,
      sessionStartMin: 22 * 60,
      sessionEndMin: 6 * 60,
      weekdayMask: 1 << 5,
    };
    expect(resolveActiveAsset(overnight, at('2026-10-23T23:00:00Z')).status).toBe('open'); // Fri 23:00
    expect(resolveActiveAsset(overnight, at('2026-10-24T05:59:00Z')).status).toBe('open'); // Sat 05:59
    expect(resolveActiveAsset(overnight, at('2026-10-24T06:00:00Z')).status).toBe('closed');
    expect(resolveActiveAsset(overnight, at('2026-10-24T23:00:00Z')).status).toBe('closed'); // Sat night
    expect(resolveActiveAsset(overnight, at('2026-10-22T05:00:00Z')).status).toBe('closed'); // Thu morning
  });

  it('gives the same result for the same input', () => {
    const now = at('2026-10-21T15:00:00Z');
    expect(resolveActiveAsset(equity, now)).toEqual(resolveActiveAsset(equity, now));
  });
});

describe('market session', () => {
  const xau: ArenaConfig = {
    ...equity,
    assetId: 3,
    fallbackAssetId: null,
    sessionStartMin: null,
    sessionEndMin: null,
    weekdayMask: 127,
  };

  it('keeps gold open on a Saturday now that its source trades 24/7', () => {
    expect(resolveActiveAsset(xau, at('2026-10-24T15:00:00Z')).status).toBe('open'); // Saturday
    expect(resolveActiveAsset(xau, at('2026-10-21T15:00:00Z')).status).toBe('open'); // Wednesday
  });

  it('keeps BTC open on a Sunday', () => {
    expect(resolveActiveAsset({ ...xau, assetId: 2 }, at('2026-10-25T12:00:00Z')).status).toBe(
      'open',
    );
  });
});
