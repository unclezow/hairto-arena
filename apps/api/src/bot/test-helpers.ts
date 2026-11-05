import { Dir } from '@hairto-arena/shared';
import { defaultBotConfig } from './bot-config.js';
import type { BotContext, PriceTick } from './strategies/bot-strategy.js';

/** One tick per second, following `prices`. */
export const ticksOf = (prices: number[], startIndex = 1, startMs = 1_000_000): PriceTick[] =>
  prices.map((price, i) => ({ tickIndex: startIndex + i, price, publishMs: startMs + i * 1000 }));

export function ctxOf(
  over: Partial<BotContext> & { prices?: number[]; level?: 1 | 2 | 3 } = {},
): BotContext {
  const { prices = [100, 100, 100], level = 2, ...rest } = over;
  return {
    ticks: ticksOf(prices),
    openPosition: null,
    elapsedSec: 5,
    heldSec: null,
    tradesUsed: 0,
    config: defaultBotConfig(level),
    oracleOk: true,
    random: () => 0.5,
    ...rest,
  };
}

/** A PRNG that returns the given values in order, then repeats the last. */
export const scripted = (values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
};

export { Dir };
