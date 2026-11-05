import { Dir, fromHex, toHex } from '@hairto-arena/shared';
import { keccak_256 } from '@noble/hashes/sha3.js';
import type { BotAction, BotContext, BotStrategy } from './strategies/bot-strategy.js';
import { concatBytes, seededRandom, uint256, type Seed } from './seed.js';

/**
 * PRNG for one tick. Derived from the seed and the tick index, so a decision never depends on how many
 * decisions came before it (a worker restart or a missed tick cannot shift later decisions).
 */
export function tickRandom(seed: Seed, tickIndex: number): () => number {
  return seededRandom(toHex(keccak_256(concatBytes(fromHex(seed), uint256(tickIndex)))));
}

/**
 * The strategy's wish, filtered by the rules every bot obeys: one position at a time, a maximum number of
 * trades, a minimum hold, no new position when the oracle is unhealthy or the round is nearly over, and a
 * forced close shortly before the deadline so the direction is always revealed.
 */
export function decideWithLimits(strategy: BotStrategy, ctx: BotContext): BotAction {
  const { config } = ctx;
  const remainingSec = config.roundSec - ctx.elapsedSec;

  if (ctx.openPosition !== null) {
    if (remainingSec <= config.closeBeforeEndSec) return { type: 'close' };
    const action = strategy.decide(ctx);
    if (action.type !== 'close') return { type: 'hold' };
    return (ctx.heldSec ?? 0) >= config.minHoldSec ? action : { type: 'hold' };
  }

  if (!ctx.oracleOk) return { type: 'hold' };
  if (ctx.tradesUsed >= config.maxTrades) return { type: 'hold' };
  if (remainingSec <= config.noOpenLastSec) return { type: 'hold' };
  const action = strategy.decide(ctx);
  if (action.type !== 'open') return { type: 'hold' };
  return action.dir === Dir.Long || action.dir === Dir.Short ? action : { type: 'hold' };
}
