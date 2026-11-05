import { describe, expect, it } from 'vitest';
import {
  capHugging,
  depositCycling,
  easyBotFarming,
  evaluate,
  winRateOutlier,
  type AbuseThresholds,
  type CountedDuel,
  type FighterSeasonData,
} from './rules.js';

const USD = 1_000_000n;
const T: AbuseThresholds = {
  minDuels: 20,
  lv1Share: 0.8,
  lv1WinRate: 0.95,
  maxCountedPerDay: 20,
  capDays: 3,
  intervalCv: 0.1,
  baselineWinRate: 0.55,
  winRateZ: 4,
  cycleCount: 3,
  cycleWindowSec: 3600,
  minDeposit: 10n * USD,
};
const W = { from: 0, to: 7 * 86_400 };
const empty: FighterSeasonData = { counted: [], startTimes: [], balanceEvents: [] };
const duels = (n: number, level: number, wins: number): CountedDuel[] =>
  Array.from({ length: n }, (_, i) => ({ level, result: i < wins ? 'win' : 'loss' }));

describe('easy-bot-farming', () => {
  it('flags mostly Lv1 duels with a near perfect win rate and keeps the counts as evidence', () => {
    const f = easyBotFarming({ ...empty, counted: duels(40, 1, 39) }, T, W)!;
    expect(f.rule).toBe('easy-bot-farming');
    expect(f.evidence).toMatchObject({ counted: 40, lv1Duels: 40, lv1Wins: 39, window: W });
    expect(f.evidence.parameters).toMatchObject({ lv1Share: 0.8, lv1WinRate: 0.95 });
    expect(f.score).toBeCloseTo(0.975);
  });

  it('does not flag a player who also takes on harder bots', () => {
    const mixed = [...duels(20, 1, 20), ...duels(20, 3, 10)];
    expect(easyBotFarming({ ...empty, counted: mixed }, T, W)).toBeNull();
  });

  it('does not flag an easy-bot player who loses a fair share', () => {
    expect(easyBotFarming({ ...empty, counted: duels(40, 1, 28) }, T, W)).toBeNull();
  });

  it('says nothing about too few duels', () => {
    expect(easyBotFarming({ ...empty, counted: duels(19, 1, 19) }, T, W)).toBeNull();
  });
});

describe('cap-hugging', () => {
  it('does not flag cap hugging when daily battles are unlimited', () => {
    expect(capHugging(empty, { ...T, maxCountedPerDay: null }, W)).toBeNull();
  });
  const day = (d: number, gapSec: (i: number) => number) => {
    let at = d * 86_400 + 3600;
    return Array.from({ length: 20 }, (_, i) => (at += gapSec(i)));
  };

  it('flags the cap reached day after day at near constant intervals', () => {
    const times = [0, 1, 2].flatMap((d) => day(d, () => 60));
    const f = capHugging({ ...empty, startTimes: times }, T, W)!;
    expect(f.rule).toBe('cap-hugging');
    expect(f.evidence.cappedDays).toEqual(['1970-01-01', '1970-01-02', '1970-01-03']);
    expect(f.evidence.gapCv).toBeCloseTo(0);
  });

  it('does not flag irregular timing even at the cap every day', () => {
    const times = [0, 1, 2].flatMap((d) => day(d, (i) => 30 + ((i * 37) % 200)));
    expect(capHugging({ ...empty, startTimes: times }, T, W)).toBeNull();
  });

  it('does not flag a cap reached on fewer days than the threshold', () => {
    const times = [0, 1].flatMap((d) => day(d, () => 60));
    expect(capHugging({ ...empty, startTimes: times }, T, W)).toBeNull();
  });

  it('does not flag regular play below the cap', () => {
    const times = [0, 1, 2, 3].flatMap((d) => day(d, () => 60).slice(0, 15));
    expect(capHugging({ ...empty, startTimes: times }, T, W)).toBeNull();
  });
});

describe('winrate-outlier', () => {
  it('flags a win rate far above the baseline over many duels', () => {
    const f = winRateOutlier({ ...empty, counted: duels(100, 2, 90) }, T, W)!;
    // (90 - 55) / sqrt(100 * .55 * .45) = 7.03
    expect(f.score).toBeCloseTo(7.03, 1);
    expect(f.evidence).toMatchObject({ counted: 100, wins: 90 });
  });

  it('does not flag a good but plausible win rate', () => {
    expect(winRateOutlier({ ...empty, counted: duels(100, 2, 66) }, T, W)).toBeNull();
  });

  it('does not flag the same rate over a handful of duels', () => {
    expect(winRateOutlier({ ...empty, counted: duels(10, 2, 10) }, T, W)).toBeNull();
  });

  it('counts draws as not winning', () => {
    const drawn: CountedDuel[] = Array.from({ length: 100 }, () => ({ level: 2, result: 'draw' }));
    expect(winRateOutlier({ ...empty, counted: drawn }, T, W)).toBeNull();
  });
});

describe('deposit-cycling', () => {
  const at = (min: number) => min * 60;
  /** Withdraw below the minimum, then deposit it back `backMin` minutes later. */
  const cycle = (startMin: number, backMin: number) => [
    { at: at(startMin), delta: -95n * USD },
    { at: at(startMin + backMin), delta: 95n * USD },
  ];
  const base = [{ at: 0, delta: 100n * USD }];

  it('flags repeated dips below the minimum that are undone quickly around duels', () => {
    const balanceEvents = [...base, ...cycle(100, 10), ...cycle(300, 10), ...cycle(500, 10)];
    const startTimes = [at(105), at(305), at(505)];
    const f = depositCycling({ ...empty, balanceEvents, startTimes }, T, W)!;
    expect(f.rule).toBe('deposit-cycling');
    expect(f.score).toBe(3);
    expect(f.evidence.cycles).toHaveLength(3);
  });

  it('ignores dips with no duel anywhere near', () => {
    const balanceEvents = [...base, ...cycle(100, 10), ...cycle(1000, 10), ...cycle(2000, 10)];
    expect(depositCycling({ ...empty, balanceEvents, startTimes: [at(5000)] }, T, W)).toBeNull();
  });

  it('ignores a dip that stays down longer than the window', () => {
    const balanceEvents = [...base, ...cycle(100, 600), ...cycle(1000, 600), ...cycle(2000, 600)];
    const startTimes = [at(150), at(1050), at(2050)];
    expect(depositCycling({ ...empty, balanceEvents, startTimes }, T, W)).toBeNull();
  });

  it('ignores a withdrawal that keeps the balance above the minimum', () => {
    const small = (m: number) => [
      { at: at(m), delta: -20n * USD },
      { at: at(m + 5), delta: 20n * USD },
    ];
    const balanceEvents = [
      { at: 0, delta: 500n * USD },
      ...small(100),
      ...small(200),
      ...small(300),
    ];
    expect(
      depositCycling({ ...empty, balanceEvents, startTimes: [at(102), at(202), at(302)] }, T, W),
    ).toBeNull();
  });

  it('flags nothing for fewer cycles than the threshold', () => {
    const balanceEvents = [...base, ...cycle(100, 10), ...cycle(300, 10)];
    expect(
      depositCycling({ ...empty, balanceEvents, startTimes: [at(105), at(305)] }, T, W),
    ).toBeNull();
  });
});

describe('evaluate', () => {
  it('returns every rule that fires and nothing for an ordinary player', () => {
    expect(evaluate({ ...empty, counted: duels(30, 2, 16) }, T, W)).toEqual([]);
    const rules = evaluate({ ...empty, counted: duels(100, 1, 100) }, T, W).map((f) => f.rule);
    expect(rules).toEqual(['easy-bot-farming', 'winrate-outlier']);
  });

  it('is deterministic', () => {
    const d = { ...empty, counted: duels(100, 1, 99) };
    expect(evaluate(d, T, W)).toEqual(evaluate(d, T, W));
  });
});
