import type { BotLevel } from '@hairto-arena/shared';
import type { BotStrategy } from './bot-strategy.js';
import { ReversionStrategy } from './reversion.strategy.js';
import { RookieStrategy } from './rookie.strategy.js';
import { TrendStrategy } from './trend.strategy.js';

export * from './bot-strategy.js';

/** Level 4 (Oracle) has no strategy in this build, so it is not served. */
export const STRATEGIES: Partial<Record<BotLevel, BotStrategy>> = {
  1: new RookieStrategy(),
  2: new TrendStrategy(),
  3: new ReversionStrategy(),
};
