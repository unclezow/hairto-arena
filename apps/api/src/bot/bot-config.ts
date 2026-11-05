import type { BotLevel } from '@hairto-arena/shared';
import { z } from 'zod';

/** Trade limits shared by every level (configuration, not contract rules). */
const limits = z.object({
  /** Most trades per duel. */
  maxTrades: z.number().int().min(1).max(10),
  /** A position must be held at least this long before it can be closed. */
  minHoldSec: z.number().min(0),
  /** Length of the round the bot plays in. */
  roundSec: z.number().positive(),
  /** Close an open position when this few seconds remain, so its direction is revealed. */
  closeBeforeEndSec: z.number().min(0),
  /** No new position when this few seconds remain. */
  noOpenLastSec: z.number().min(0),
});

export const botConfigSchema = limits.extend({
  /** Strategy specific numbers; see the defaults below. */
  params: z.record(z.string(), z.number()),
});

export type BotConfig = z.infer<typeof botConfigSchema>;

const LIMITS = {
  maxTrades: 3,
  minHoldSec: 3,
  roundSec: 30,
  closeBeforeEndSec: 3,
  noOpenLastSec: 6,
} as const;

const DEFAULT_PARAMS: Partial<Record<BotLevel, Record<string, number>>> = {
  // Lv1 Rookie: short trend, wrong a third of the time, rarely holds.
  1: { windowTicks: 3, openProb: 0.35, errorRate: 0.33, closeProb: 0.5 },
  // Lv2 Trend: follows a clear trend and holds a medium time.
  2: { windowTicks: 8, thresholdBps: 0.4, holdSec: 8, reverseBps: 0.3 },
  // Lv3 Reversion: fades stretched prices when volatility is in a usable range.
  3: {
    windowTicks: 15,
    zEntry: 1.2,
    zExit: 0.3,
    minVolBps: 0.3,
    maxVolBps: 12,
    baseHoldSec: 10,
    refVolBps: 2,
  },
};

export function defaultBotConfig(level: BotLevel): BotConfig {
  return { ...LIMITS, params: { ...DEFAULT_PARAMS[level] } };
}

/**
 * Effective config for a duel: the defaults of the level overlaid with the admin's stored JSON.
 * Unknown strategy params are kept (a newer admin tool may know more than this build).
 */
export function resolveBotConfig(level: BotLevel, stored: unknown): BotConfig {
  const base = defaultBotConfig(level);
  const parsed = botConfigSchema.partial().safeParse(stored ?? {});
  if (!parsed.success) throw new Error(`Invalid bot config: ${z.prettifyError(parsed.error)}`);
  return botConfigSchema.parse({
    ...base,
    ...parsed.data,
    params: { ...base.params, ...parsed.data.params },
  });
}
