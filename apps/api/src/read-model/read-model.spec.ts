import { PRIZE_CURVE_BPS } from '@hairto-arena/shared';
import { describe, expect, it } from 'vitest';
import { bonusEstimate, estimateVault, fighterPrize, potSplit } from './estimates.js';
import { nextBetterTier, tierOf, tiersOf } from './prize-tiers.js';
import { seasonPhase } from './season-clock.js';

describe('prize tiers', () => {
  it('groups equal shares into 1, 2, 3, 4, 5, 6-10, 11-20', () => {
    expect(tiersOf(PRIZE_CURVE_BPS)).toEqual([
      { from: 1, to: 1, bps: 2500 },
      { from: 2, to: 2, bps: 1700 },
      { from: 3, to: 3, bps: 1300 },
      { from: 4, to: 4, bps: 1000 },
      { from: 5, to: 5, bps: 500 },
      { from: 6, to: 10, bps: 300 },
      { from: 11, to: 20, bps: 150 },
    ]);
  });

  it('shares add up to 100 percent', () => {
    expect(PRIZE_CURVE_BPS.reduce((a, b) => a + b, 0)).toBe(10_000);
  });

  it('finds the tier of a rank, and none beyond the table', () => {
    expect(tierOf(PRIZE_CURVE_BPS, 8)).toMatchObject({ from: 6, to: 10 });
    expect(tierOf(PRIZE_CURVE_BPS, 20)).toMatchObject({ from: 11, to: 20 });
    expect(tierOf(PRIZE_CURVE_BPS, 21)).toBeNull();
  });

  it('finds the tier above, the lowest paid tier for an unpaid rank, and nothing for rank 1', () => {
    expect(nextBetterTier(PRIZE_CURVE_BPS, 15)).toMatchObject({ from: 6, to: 10 });
    expect(nextBetterTier(PRIZE_CURVE_BPS, 6)).toMatchObject({ from: 5, to: 5 });
    expect(nextBetterTier(PRIZE_CURVE_BPS, 2)).toMatchObject({ from: 1, to: 1 });
    expect(nextBetterTier(PRIZE_CURVE_BPS, 1)).toBeNull();
    expect(nextBetterTier(PRIZE_CURVE_BPS, 40)).toMatchObject({ from: 11, to: 20 });
  });
});

describe('pot estimates', () => {
  const usd = (n: number) => BigInt(Math.round(n * 1e6));
  const A = { feeBps: 500, ownerShareBps: 0 };
  const B = { feeBps: 1000, ownerShareBps: 5000 };
  const week = 7 * 24 * 60 * 60;

  // At 5 percent a year: small, medium and large scenarios.
  it.each([
    ['small', 10_000, 100_000, 52.4],
    ['medium', 100_000, 1_000_000, 524.04],
    ['large', 1_000_000, 10_000_000, 5240.38],
  ])('matches the reference table for the %s scenario', (_name, tvlA, tvlB, pot) => {
    const a = estimateVault({ tvl: usd(tvlA), ...A }, 500, week);
    const b = estimateVault({ tvl: usd(tvlB), ...B }, 500, week);
    expect(Number(a.toPot + b.toPot) / 1e6).toBeCloseTo(pot, 1);
  });

  it('splits every unit of yield into fee, owner share and pot', () => {
    const b = estimateVault({ tvl: usd(100_000), ...B }, 500, week);
    expect(b.fee + b.toOwners + b.toPot).toBe(b.grossYield);
    expect(Number(b.fee) / Number(b.grossYield)).toBeCloseTo(0.1, 5);
  });

  it('can read the Backer pool split from the gross yield instead', () => {
    const afterFee = estimateVault({ tvl: usd(100_000), ...B }, 500, week);
    const gross = estimateVault({ tvl: usd(100_000), ...B, splitMode: 'gross' }, 500, week);
    // After fee: 45 percent of gross each. From gross: 50 percent back to owners and 40 percent to the pot.
    expect(Number(afterFee.toOwners) / Number(afterFee.grossYield)).toBeCloseTo(0.45, 4);
    expect(Number(gross.toOwners) / Number(gross.grossYield)).toBeCloseTo(0.5, 4);
    expect(Number(gross.toPot) / Number(gross.grossYield)).toBeCloseTo(0.4, 4);
    expect(gross.fee + gross.toOwners + gross.toPot).toBe(gross.grossYield);
  });

  it('estimates nothing for an empty vault', () => {
    expect(estimateVault({ tvl: 0n, ...A }, 500, week)).toEqual({
      grossYield: 0n,
      fee: 0n,
      toOwners: 0n,
      toPot: 0n,
    });
  });

  it('splits the pot 75 / 25 without losing a unit', () => {
    const { fighterPool, backerPool } = potSplit(1_000_001n, 7500);
    expect(fighterPool).toBe(750_000n);
    expect(fighterPool + backerPool).toBe(1_000_001n);
  });

  it('pays rank 1 a quarter of the fighter pool and never more than the pool in total', () => {
    const pool = 750_000_000n;
    expect(fighterPrize(pool, PRIZE_CURVE_BPS[0]!)).toBe(187_500_000n);
    const total = PRIZE_CURVE_BPS.reduce((sum, bps) => sum + fighterPrize(pool, bps), 0n);
    expect(total).toBeLessThanOrEqual(pool);
  });
});

describe('bonusEstimate', () => {
  const base = {
    backerPool: 1000n,
    pickedFighterPrizeBps: 2500,
    totalPrizeBps: 10_000,
    myTwab: 50n,
    totalTwabOfPickedFighter: 100n,
  };

  it('is the pool times the fighter’s prize share times the backer’s share of that fighter’s backers', () => {
    // 1000 * 25% * 50% = 125
    expect(bonusEstimate(base)).toBe(125n);
  });

  it('is zero when the picked fighter wins no prize or nobody backs them', () => {
    expect(bonusEstimate({ ...base, pickedFighterPrizeBps: 0 })).toBe(0n);
    expect(bonusEstimate({ ...base, totalTwabOfPickedFighter: 0n })).toBe(0n);
    expect(bonusEstimate({ ...base, totalPrizeBps: 0 })).toBe(0n);
  });

  it('grows when fewer ranks are filled, because the same pool is shared among fewer prizes', () => {
    expect(bonusEstimate({ ...base, totalPrizeBps: 5000 })).toBe(250n);
  });
});

describe('seasonPhase', () => {
  const start = new Date('2026-10-20T00:00:00Z');
  const end = new Date('2026-10-27T00:00:00Z');
  const windows = { pickWindowMs: 24 * 3600_000, disputeWindowMs: 3600_000 };
  const season = {
    startAt: start,
    endAt: end,
    phase: 'active',
    resultsPostedAt: null as Date | null,
  };
  const at = (iso: string) => new Date(iso);

  it('opens with the pick window, then is active until the end', () => {
    expect(seasonPhase(season, at('2026-10-20T12:00:00Z'), windows)).toBe('pick-window');
    expect(seasonPhase(season, at('2026-10-21T00:00:00Z'), windows)).toBe('active');
    expect(seasonPhase(season, at('2026-10-26T23:59:59Z'), windows)).toBe('active');
  });

  it('is closed after the end time, or once the chain says so', () => {
    expect(seasonPhase(season, at('2026-10-27T00:00:00Z'), windows)).toBe('closed');
    expect(seasonPhase({ ...season, phase: 'closed' }, at('2026-10-22T00:00:00Z'), windows)).toBe(
      'closed',
    );
  });

  it('has a dispute window after the results are posted, then claims open', () => {
    const posted = {
      ...season,
      phase: 'results_posted',
      resultsPostedAt: at('2026-10-27T02:00:00Z'),
    };
    expect(seasonPhase(posted, at('2026-10-27T02:30:00Z'), windows)).toBe('dispute-window');
    expect(seasonPhase(posted, at('2026-10-27T03:00:00Z'), windows)).toBe('claimable');
  });
});
