import { Dir } from '@hairto-arena/shared';
import { describe, expect, it } from 'vitest';
import { ctxOf, scripted } from '../test-helpers.js';
import { ReversionStrategy } from './reversion.strategy.js';
import { RookieStrategy } from './rookie.strategy.js';
import { TrendStrategy } from './trend.strategy.js';

// 10 bps up over 8 ticks.
const UP = [100, 100.01, 100.02, 100.03, 100.04, 100.05, 100.07, 100.09, 100.1];
const DOWN = UP.map((p) => 200 - p);

describe('TrendStrategy', () => {
  const trend = new TrendStrategy();

  it('opens long in an uptrend and short in a downtrend', () => {
    expect(trend.decide(ctxOf({ prices: UP }))).toEqual({ type: 'open', dir: Dir.Long });
    expect(trend.decide(ctxOf({ prices: DOWN }))).toEqual({ type: 'open', dir: Dir.Short });
  });

  it('stays out when there is no clear trend', () => {
    expect(trend.decide(ctxOf({ prices: [100, 100, 100, 100, 100] }))).toEqual({ type: 'hold' });
  });

  it('holds the position for the configured time, then closes', () => {
    const base = { prices: UP, openPosition: Dir.Long } as const;
    expect(trend.decide(ctxOf({ ...base, heldSec: 3 }))).toEqual({ type: 'hold' });
    expect(trend.decide(ctxOf({ ...base, heldSec: 8 }))).toEqual({ type: 'close' });
  });

  it('gets out early when the price turns against the position', () => {
    const turned = [...UP, 100.05];
    expect(trend.decide(ctxOf({ prices: turned, openPosition: Dir.Long, heldSec: 2 }))).toEqual({
      type: 'close',
    });
  });
});

describe('ReversionStrategy', () => {
  const reversion = new ReversionStrategy();
  const calm = (n: number, jitter = 0.002) =>
    Array.from({ length: n }, (_, i) => 100 + (i % 2 === 0 ? jitter : -jitter));

  it('shorts a price stretched above its mean and buys one stretched below', () => {
    expect(reversion.decide(ctxOf({ level: 3, prices: [...calm(14), 100.02] }))).toEqual({
      type: 'open',
      dir: Dir.Short,
    });
    expect(reversion.decide(ctxOf({ level: 3, prices: [...calm(14), 99.98] }))).toEqual({
      type: 'open',
      dir: Dir.Long,
    });
  });

  it('stays out of a dead market', () => {
    expect(reversion.decide(ctxOf({ level: 3, prices: Array(15).fill(100) }))).toEqual({
      type: 'hold',
    });
  });

  it('stays out of a market that is too volatile', () => {
    const wild = Array.from({ length: 15 }, (_, i) => (i % 2 === 0 ? 100 : 101));
    expect(reversion.decide(ctxOf({ level: 3, prices: [...wild, 103] }))).toEqual({ type: 'hold' });
  });

  it('waits for enough history before trading', () => {
    expect(reversion.decide(ctxOf({ level: 3, prices: [100, 100.5] }))).toEqual({ type: 'hold' });
  });

  it('closes once the price has reverted to its mean', () => {
    const reverted = [...calm(14), 100];
    expect(
      reversion.decide(ctxOf({ level: 3, prices: reverted, openPosition: Dir.Short, heldSec: 2 })),
    ).toEqual({ type: 'close' });
  });

  it('closes a stale position after the adaptive hold time', () => {
    const stretched = [...calm(14), 100.02];
    const ctx = (heldSec: number) =>
      ctxOf({ level: 3, prices: stretched, openPosition: Dir.Short, heldSec });
    expect(reversion.decide(ctx(1))).toEqual({ type: 'hold' });
    expect(reversion.decide(ctx(30))).toEqual({ type: 'close' });
  });
});

describe('RookieStrategy', () => {
  const rookie = new RookieStrategy();
  const rookieCtx = (random: () => number, over = {}) =>
    ctxOf({ level: 1, prices: UP, random, ...over });

  it('follows the short trend when it does not make a mistake', () => {
    // open roll below openProb, error roll above errorRate
    expect(rookie.decide(rookieCtx(scripted([0.1, 0.9])))).toEqual({ type: 'open', dir: Dir.Long });
    expect(rookie.decide(rookieCtx(scripted([0.1, 0.9]), { prices: DOWN }))).toEqual({
      type: 'open',
      dir: Dir.Short,
    });
  });

  it('sometimes trades against the trend by mistake', () => {
    expect(rookie.decide(rookieCtx(scripted([0.1, 0.1])))).toEqual({
      type: 'open',
      dir: Dir.Short,
    });
  });

  it('often does nothing', () => {
    expect(rookie.decide(rookieCtx(scripted([0.9])))).toEqual({ type: 'hold' });
  });

  it('rarely holds: closes on most rolls', () => {
    const open = { openPosition: Dir.Long, heldSec: 4 };
    expect(rookie.decide(rookieCtx(scripted([0.1]), open))).toEqual({ type: 'close' });
    expect(rookie.decide(rookieCtx(scripted([0.9]), open))).toEqual({ type: 'hold' });
  });
});

describe('all strategies', () => {
  const strategies = [new RookieStrategy(), new TrendStrategy(), new ReversionStrategy()];

  it.each(strategies.map((s) => [s.name, s] as const))(
    '%s gives the same action for the same context and random source',
    (_name, strategy) => {
      const make = () =>
        ctxOf({ level: strategy.level, prices: UP, random: scripted([0.2, 0.7, 0.4]) });
      expect(strategy.decide(make())).toEqual(strategy.decide(make()));
    },
  );
});
