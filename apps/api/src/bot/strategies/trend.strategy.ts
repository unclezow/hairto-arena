import { Dir } from '@hairto-arena/shared';
import type { BotAction, BotContext, BotStrategy } from './bot-strategy.js';
import { changeBps } from './indicators.js';

/** Lv2 Trend: follows a clear trend and holds for a medium time. */
export class TrendStrategy implements BotStrategy {
  readonly level = 2 as const;
  readonly name = 'Trend';

  decide(ctx: BotContext): BotAction {
    const { windowTicks, thresholdBps, holdSec, reverseBps } = ctx.config.params;
    const trend = changeBps(ctx.ticks, windowTicks ?? 8);

    if (ctx.openPosition !== null) {
      const heldLongEnough = (ctx.heldSec ?? 0) >= (holdSec ?? 8);
      // The trend turned against the position: get out even before the hold time is up.
      const recent = changeBps(ctx.ticks, 2);
      const against =
        ctx.openPosition === Dir.Long
          ? recent <= -(reverseBps ?? 0.3)
          : recent >= (reverseBps ?? 0.3);
      return heldLongEnough || against ? { type: 'close' } : { type: 'hold' };
    }

    const threshold = thresholdBps ?? 0.4;
    if (trend >= threshold) return { type: 'open', dir: Dir.Long };
    if (trend <= -threshold) return { type: 'open', dir: Dir.Short };
    return { type: 'hold' };
  }
}
