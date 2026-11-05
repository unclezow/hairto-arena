import { Dir } from '@hairto-arena/shared';
import { describe, expect, it } from 'vitest';
import { BotBrain, reproduceBotTrades } from '../src/bot/bot-brain.js';
import { defaultBotConfig } from '../src/bot/bot-config.js';
import { climbingTick } from './helpers/fake-bot-gateway.js';

const seed = 'ab'.repeat(32);
const init = { level: 2 as const, config: defaultBotConfig(2), seed, startMs: 1_000_000 };
const ticks = Array.from({ length: 36 }, (_, s) => climbingTick(s));

describe('BotBrain', () => {
  it('ignores ticks before the round starts', () => {
    const brain = new BotBrain({ ...init, startMs: 1_010_000 });
    expect(brain.decide(climbingTick(5), true)).toEqual({ type: 'hold' });
  });

  it('makes the same decisions for the same seed and ticks', () => {
    const run = () => {
      const brain = new BotBrain(init);
      return ticks.map((t) => {
        const action = brain.decide(t, true);
        if (action.type === 'open') brain.confirmOpen(action.dir, t);
        if (action.type === 'close') brain.confirmClose();
        return action;
      });
    };
    expect(run()).toEqual(run());
  });

  it('decides the same on a tick whether or not later ticks exist (no look-ahead)', () => {
    const decisions = (series: typeof ticks) => {
      const brain = new BotBrain(init);
      return series.map((t) => {
        const action = brain.decide(t, true);
        if (action.type === 'open') brain.confirmOpen(action.dir, t);
        if (action.type === 'close') brain.confirmClose();
        return action;
      });
    };
    const full = decisions(ticks);
    for (const cut of [8, 15, 22]) {
      expect(decisions(ticks.slice(0, cut))).toEqual(full.slice(0, cut));
    }
  });

  it('counts trades and numbers them for the commit salt', () => {
    const brain = new BotBrain(init);
    const first = brain.confirmOpen(Dir.Long, ticks[10]!);
    brain.confirmClose();
    const second = brain.confirmOpen(Dir.Short, ticks[20]!);
    expect([first.tradeIndex, second.tradeIndex]).toEqual([0, 1]);
    expect(brain.state.tradesUsed).toBe(2);
  });

  it('can be restored from saved state', () => {
    const a = new BotBrain(init);
    a.confirmOpen(Dir.Long, ticks[10]!);
    const b = new BotBrain(init);
    b.restore(a.state);
    expect(b.state).toEqual(a.state);
    expect(b.state.open).not.toBe(a.state.open);
  });
});

describe('reproduceBotTrades', () => {
  it('opens in the trend, then closes before the round ends so the direction is revealed', () => {
    const trades = reproduceBotTrades(init, ticks);
    expect(trades.length).toBeGreaterThan(0);
    expect(trades[0]!.dir).toBe(Dir.Long);
    expect(trades.every((t) => t.closedAtTick !== null)).toBe(true);
    const lastClose = Math.max(...trades.map((t) => t.closedAtTick!));
    // Tick index = second + 1, round is 30 s, forced close at 3 s before the end.
    expect(lastClose).toBeLessThanOrEqual(30);
  });

  it('never exceeds the maximum number of trades', () => {
    const trades = reproduceBotTrades({ ...init, config: { ...init.config, maxTrades: 1 } }, ticks);
    expect(trades.length).toBeLessThanOrEqual(1);
  });

  it('is identical for the same inputs and different for another seed', () => {
    expect(reproduceBotTrades(init, ticks)).toEqual(reproduceBotTrades(init, ticks));
    const rookie = (s: string) =>
      reproduceBotTrades(
        { level: 1, config: defaultBotConfig(1), seed: s, startMs: 1_000_000 },
        ticks,
      );
    expect(rookie(seed)).not.toEqual(rookie('cd'.repeat(32)));
  });
});
