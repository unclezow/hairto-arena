import { describe, expect, it } from 'vitest';
import { DAMAGE, DUEL } from '@hairto-arena/shared';
import fixtures from '../../../test/fixtures/damage-pnl-difference.json' with { type: 'json' };
import { resolveDuel, type ClosedTrade } from './damage-strategy.js';
import { AssetScaledStrategy } from './asset-scaled.strategy.js';
import { PnlDifferenceStrategy } from './pnl-difference.strategy.js';

interface Case {
  name: string;
  trades: ClosedTrade[];
  expected: { hpFighter: number; hpBot: number; winner: string };
}

describe('PnlDifferenceStrategy', () => {
  const strategy = new PnlDifferenceStrategy(fixtures.options);

  it('uses the same numbers as the contract params', () => {
    expect(fixtures.options).toEqual({
      startingHp: DUEL.startingHp,
      ppmPerHp: DAMAGE.ppmPerHp,
      paperCostPpm: DAMAGE.paperCostPpm,
      unrevealedBasePenaltyPpm: DAMAGE.unrevealedBasePenaltyPpm,
    });
  });

  describe.each(fixtures.cases as Case[])('$name', (c) => {
    it('gives the contract HP and winner', () => {
      const outcome = resolveDuel(strategy, {
        startingHp: fixtures.options.startingHp,
        assetId: 1,
        trades: c.trades,
      });
      expect(outcome).toMatchObject(c.expected);
    });
  });

  it('matches PnlDifferenceDamage.computeDamage', () => {
    expect(strategy.computeDamage(500)).toEqual({ selfDelta: 0, opponentDelta: -50 });
    expect(strategy.computeDamage(-300)).toEqual({ selfDelta: -30, opponentDelta: 0 });
    expect(strategy.computeDamage(0)).toEqual({ selfDelta: 0, opponentDelta: 0 });
    // Truncates toward zero and caps at the starting HP.
    expect(strategy.computeDamage(19)).toEqual({ selfDelta: 0, opponentDelta: -1 });
    expect(strategy.computeDamage(-1_000_000)).toEqual({ selfDelta: -1000, opponentDelta: 0 });
  });

  it('matches PnlDifferenceDamage.unrevealedPenalty', () => {
    expect(strategy.unrevealedPenalty(200)).toBe(-300);
  });

  it('decides by net PnL before HP when HP is clamped', () => {
    // Both sides drop to 0 HP, but the fighter scored more.
    const outcome = resolveDuel(strategy, {
      startingHp: 1000,
      assetId: 1,
      trades: [
        { side: 'fighter', pnlPpm: 20_000 },
        { side: 'bot', pnlPpm: 15_000 },
      ],
    });
    expect(outcome).toMatchObject({ hpFighter: 0, hpBot: 0, winner: 'fighter' });
  });
});

describe('AssetScaledStrategy', () => {
  const strategy = new AssetScaledStrategy({
    hpPerBps: (id) => ({ 1: 200, 2: 120, 3: 500 })[id] ?? 150,
    maxHitHp: 400,
    paperCostPpm: 0,
    unrevealedBasePenaltyPpm: 100,
  });

  it('matches the contract: |bps| x scale, capped, truncated toward zero', () => {
    expect(strategy.computeDamage(100, 2)).toEqual({ selfDelta: 0, opponentDelta: -120 });
    expect(strategy.computeDamage(25, 2)).toEqual({ selfDelta: 0, opponentDelta: -30 });
    expect(strategy.computeDamage(-50, 1)).toEqual({ selfDelta: -100, opponentDelta: 0 });
    expect(strategy.computeDamage(100, 3)).toEqual({ selfDelta: 0, opponentDelta: -400 });
    expect(strategy.computeDamage(100, 9)).toEqual({ selfDelta: 0, opponentDelta: -150 });
    expect(strategy.computeDamage(1, 2)).toEqual({ selfDelta: 0, opponentDelta: -1 });
  });

  it('lets a few strong trades knock the bot out', () => {
    const outcome = resolveDuel(strategy, {
      startingHp: 1000,
      assetId: 2,
      trades: [400, 300, 350].map((pnlPpm) => ({ side: 'fighter' as const, pnlPpm })),
    });
    expect(outcome.hpBot).toBe(0);
    expect(outcome.winner).toBe('fighter');
  });
});
