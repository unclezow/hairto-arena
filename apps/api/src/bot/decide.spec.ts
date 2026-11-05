import { Dir } from '@hairto-arena/shared';
import { describe, expect, it } from 'vitest';
import { decideWithLimits, tickRandom } from './decide.js';
import type { BotStrategy } from './strategies/bot-strategy.js';
import { ctxOf } from './test-helpers.js';

const always = (type: 'open' | 'close'): BotStrategy => ({
  level: 2,
  name: 'always',
  decide: () => (type === 'open' ? { type: 'open', dir: Dir.Long } : { type: 'close' }),
});

describe('decideWithLimits', () => {
  it('lets the strategy open a position when everything allows it', () => {
    expect(decideWithLimits(always('open'), ctxOf())).toEqual({ type: 'open', dir: Dir.Long });
  });

  it('holds once the maximum number of trades is used', () => {
    expect(decideWithLimits(always('open'), ctxOf({ tradesUsed: 3 }))).toEqual({ type: 'hold' });
    expect(decideWithLimits(always('open'), ctxOf({ tradesUsed: 2 }))).toEqual({
      type: 'open',
      dir: Dir.Long,
    });
  });

  it('does not close before the minimum hold time', () => {
    const open = { openPosition: Dir.Long } as const;
    expect(decideWithLimits(always('close'), ctxOf({ ...open, heldSec: 2 }))).toEqual({
      type: 'hold',
    });
    expect(decideWithLimits(always('close'), ctxOf({ ...open, heldSec: 3 }))).toEqual({
      type: 'close',
    });
  });

  it('never opens a second position while one is open', () => {
    expect(decideWithLimits(always('open'), ctxOf({ openPosition: Dir.Long, heldSec: 5 }))).toEqual(
      {
        type: 'hold',
      },
    );
  });

  it('does not open while the oracle is stale or in outage', () => {
    expect(decideWithLimits(always('open'), ctxOf({ oracleOk: false }))).toEqual({ type: 'hold' });
  });

  it('can still close while the oracle is unhealthy', () => {
    expect(
      decideWithLimits(
        always('close'),
        ctxOf({ oracleOk: false, openPosition: Dir.Long, heldSec: 5 }),
      ),
    ).toEqual({ type: 'close' });
  });

  it('does not open a position in the last seconds of the round', () => {
    expect(decideWithLimits(always('open'), ctxOf({ elapsedSec: 24 }))).toEqual({ type: 'hold' });
    expect(decideWithLimits(always('open'), ctxOf({ elapsedSec: 23 }))).toEqual({
      type: 'open',
      dir: Dir.Long,
    });
  });

  it('forces a close shortly before the deadline even if the strategy wants to hold', () => {
    const holder: BotStrategy = { level: 2, name: 'holder', decide: () => ({ type: 'hold' }) };
    const open = { openPosition: Dir.Short, heldSec: 1 } as const;
    expect(decideWithLimits(holder, ctxOf({ ...open, elapsedSec: 26 }))).toEqual({ type: 'hold' });
    expect(decideWithLimits(holder, ctxOf({ ...open, elapsedSec: 27 }))).toEqual({ type: 'close' });
  });
});

describe('tickRandom', () => {
  const seed = 'ab'.repeat(32);
  const draw = (rand: () => number) => [rand(), rand(), rand()];

  it('is the same for the same seed and tick', () => {
    expect(draw(tickRandom(seed, 12))).toEqual(draw(tickRandom(seed, 12)));
  });

  it('differs between ticks and between seeds', () => {
    expect(draw(tickRandom(seed, 12))).not.toEqual(draw(tickRandom(seed, 13)));
    expect(draw(tickRandom(seed, 12))).not.toEqual(draw(tickRandom('cd'.repeat(32), 12)));
  });

  it('does not depend on which ticks were drawn before (a missed tick cannot shift later decisions)', () => {
    draw(tickRandom(seed, 11));
    const afterSkip = draw(tickRandom(seed, 12));
    expect(afterSkip).toEqual(draw(tickRandom(seed, 12)));
  });
});
