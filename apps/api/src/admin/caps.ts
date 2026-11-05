import { z } from 'zod';
import type { BotLevel } from '@hairto-arena/shared';
import { defaultBotConfig } from '../bot/bot-config.js';

/**
 * Limits for everything an admin can type. Where a number also exists in the contracts it is not editable here
 * (`roundSec` is the duel length); the rest are bounded so a typo cannot make a bot do something absurd.
 */
export const ARENA_CAPS = {
  nameMax: 64,
  minuteOfDay: { min: 0, max: 24 * 60 - 1 },
  weekdayMask: { min: 1, max: 127 },
} as const;

export const BOT_CAPS = {
  maxTrades: { min: 1, max: 10 },
  minHoldSec: { min: 0, max: 30 },
  closeBeforeEndSec: { min: 0, max: 30 },
  noOpenLastSec: { min: 0, max: 60 },
  param: { min: -1000, max: 1000 },
  /** Names of strategy parameters that are probabilities. */
  isProbability: (name: string) => /prob$|rate$/i.test(name),
} as const;

const range = (r: { min: number; max: number }) => z.number().min(r.min).max(r.max);

export const arenaFields = {
  name: z.string().trim().min(1).max(ARENA_CAPS.nameMax),
  assetId: z.number().int().nonnegative(),
  fallbackAssetId: z.number().int().nonnegative().nullable(),
  sessionStartMin: range(ARENA_CAPS.minuteOfDay).pipe(z.number().int()).nullable(),
  sessionEndMin: range(ARENA_CAPS.minuteOfDay).pipe(z.number().int()).nullable(),
  weekdayMask: range(ARENA_CAPS.weekdayMask).pipe(z.number().int()),
  active: z.boolean(),
};

export const createArenaSchema = z
  .object({
    name: arenaFields.name,
    assetId: arenaFields.assetId,
    fallbackAssetId: arenaFields.fallbackAssetId.default(null),
    sessionStartMin: arenaFields.sessionStartMin.default(null),
    sessionEndMin: arenaFields.sessionEndMin.default(null),
    weekdayMask: arenaFields.weekdayMask.default(127),
    active: arenaFields.active.default(true),
  })
  .strict();

export const updateArenaSchema = z.object(arenaFields).partial().strict();

export type ArenaInput = z.infer<typeof createArenaSchema>;

export const botPatchSchema = z
  .object({
    active: z.boolean().optional(),
    config: z
      .object({
        maxTrades: range(BOT_CAPS.maxTrades).pipe(z.number().int()).optional(),
        minHoldSec: range(BOT_CAPS.minHoldSec).optional(),
        closeBeforeEndSec: range(BOT_CAPS.closeBeforeEndSec).optional(),
        noOpenLastSec: range(BOT_CAPS.noOpenLastSec).optional(),
        params: z.record(z.string(), range(BOT_CAPS.param)).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => v.active !== undefined || v.config !== undefined, 'nothing to change');

export type BotPatch = z.infer<typeof botPatchSchema>;

/** Problems with strategy parameters that the shape alone cannot catch. Empty means fine. */
export function botParamProblems(level: BotLevel, params: Record<string, number> | undefined) {
  const known = defaultBotConfig(level).params;
  const problems: { path: string; message: string }[] = [];
  for (const [name, value] of Object.entries(params ?? {})) {
    if (!(name in known))
      problems.push({ path: `config.params.${name}`, message: 'unknown parameter' });
    else if (BOT_CAPS.isProbability(name) && (value < 0 || value > 1)) {
      problems.push({ path: `config.params.${name}`, message: 'must be between 0 and 1' });
    }
  }
  return problems;
}
