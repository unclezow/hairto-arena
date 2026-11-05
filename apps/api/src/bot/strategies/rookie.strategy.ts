import { Dir } from '@hairto-arena/shared';
import type { BotAction, BotContext, BotStrategy } from './bot-strategy.js';
import { changeBps } from './indicators.js';

/** Lv1 Rookie: follows the short trend with random mistakes and rarely holds. */
export class RookieStrategy implements BotStrategy {
  readonly level = 1 as const;
  readonly name = 'Rookie';

  decide(ctx: BotContext): BotAction {
    const { windowTicks, openProb, errorRate, closeProb } = ctx.config.params;

    if (ctx.openPosition !== null) {
      return ctx.random() < (closeProb ?? 0.5) ? { type: 'close' } : { type: 'hold' };
    }
    if (ctx.random() >= (openProb ?? 0.35)) return { type: 'hold' };

    const move = changeBps(ctx.ticks, windowTicks ?? 3);
    // Without a visible trend it guesses; with one it follows it, unless it makes a mistake.
    let dir =
      move === 0 ? (ctx.random() < 0.5 ? Dir.Long : Dir.Short) : move > 0 ? Dir.Long : Dir.Short;
    if (ctx.random() < (errorRate ?? 0.33)) dir = dir === Dir.Long ? Dir.Short : Dir.Long;
    return { type: 'open', dir };
  }
}
