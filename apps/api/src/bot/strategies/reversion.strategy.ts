import { Dir } from '@hairto-arena/shared';
import type { BotAction, BotContext, BotStrategy } from './bot-strategy.js';
import { mean, recentPrices, stdev } from './indicators.js';

/** Lv3 Reversion: fades stretched prices when volatility is usable; hold time adapts to volatility. */
export class ReversionStrategy implements BotStrategy {
  readonly level = 3 as const;
  readonly name = 'Reversion';

  decide(ctx: BotContext): BotAction {
    const p = ctx.config.params;
    const windowTicks = p.windowTicks ?? 15;
    if (ctx.ticks.length < Math.min(windowTicks, 5)) return { type: 'hold' };

    const prices = recentPrices(ctx.ticks, windowTicks);
    const avg = mean(prices);
    const sd = stdev(prices);
    const last = prices[prices.length - 1]!;
    const volBps = avg === 0 ? 0 : (sd / avg) * 10_000;
    const z = sd === 0 ? 0 : (last - avg) / sd;

    if (ctx.openPosition !== null) {
      // Quiet markets revert slowly, busy ones quickly: scale the hold time by reference volatility.
      const refVol = p.refVolBps ?? 2;
      const maxHold =
        (p.baseHoldSec ?? 10) * Math.min(2, Math.max(0.5, refVol / Math.max(volBps, 0.01)));
      const reverted = Math.abs(z) <= (p.zExit ?? 0.3);
      return reverted || (ctx.heldSec ?? 0) >= maxHold ? { type: 'close' } : { type: 'hold' };
    }

    // Volatility filter: no edge in a dead market, too much noise in a wild one.
    if (volBps < (p.minVolBps ?? 0.3) || volBps > (p.maxVolBps ?? 12)) return { type: 'hold' };
    const entry = p.zEntry ?? 1.2;
    if (z >= entry) return { type: 'open', dir: Dir.Short };
    if (z <= -entry) return { type: 'open', dir: Dir.Long };
    return { type: 'hold' };
  }
}
