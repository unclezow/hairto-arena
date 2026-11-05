import { WS_EVENTS } from '@hairto-arena/shared';
import { z } from 'zod';

/**
 * What may leave the server on each event. This is the single place that decides it: every message, whoever
 * published it, is parsed against these schemas and anything not listed is dropped. In particular a position
 * that is only opened never carries a direction, HP deltas or PnL, and a seed appears only on `duel:seed` and
 * `duel:result`, which are published after the on-chain reveal.
 */
const base = {
  duelId: z.string(),
  seq: z.number().int().nonnegative(),
  provisional: z.boolean(),
};

const dir = z.union([z.literal(1), z.literal(2)]);

const positionFields = {
  player: z.string(),
  isBot: z.boolean(),
  state: z.enum(['opened', 'closed']),
  tick: z.number().int().nullable(),
  // Null on a penalized position: it was never revealed.
  dir: dir.nullable().optional(),
  pnlPpm: z.number().int().optional(),
  selfDelta: z.number().int().optional(),
  opponentDelta: z.number().int().optional(),
  penalized: z.boolean().optional(),
};

/** An opened position keeps its direction secret until it is closed. */
function hideOpenDirection<T extends { state: 'opened' | 'closed' }>(position: T) {
  if (position.state === 'closed') return position;
  const {
    dir: _dir,
    pnlPpm: _pnl,
    selfDelta: _self,
    opponentDelta: _opponent,
    penalized: _penalized,
    ...visible
  } = position as T & {
    dir?: unknown;
    pnlPpm?: unknown;
    selfDelta?: unknown;
    opponentDelta?: unknown;
    penalized?: unknown;
  };
  return visible as Omit<T, 'dir' | 'pnlPpm' | 'selfDelta' | 'opponentDelta' | 'penalized'>;
}

const position = z.object(positionFields).transform(hideOpenDirection);

export const EVENT_SCHEMAS = {
  [WS_EVENTS.tick]: z.object({
    assetId: z.number().int(),
    tickIndex: z.number().int(),
    price: z.string(),
    publishMs: z.number().int(),
  }),
  [WS_EVENTS.quote]: z.object({
    assetId: z.number().int(),
    price: z.string(),
    expo: z.number().int(),
    publishMs: z.number().int(),
  }),
  [WS_EVENTS.oracleHealth]: z.object({
    assetId: z.number().int(),
    status: z.enum(['ok', 'stale', 'outage']),
    lastPublishMs: z.number().int(),
  }),
  [WS_EVENTS.duelStarted]: z.object({
    ...base,
    fighter: z.string(),
    botLevel: z.number().int(),
    assetId: z.number().int(),
    startMs: z.number().int(),
    fighterCharacter: z.number().int().nonnegative(),
    botCharacter: z.number().int().nonnegative(),
  }),
  [WS_EVENTS.duelPosition]: z.object({ ...base, ...positionFields }).transform(hideOpenDirection),
  [WS_EVENTS.hpUpdate]: z.object({
    ...base,
    hpFighter: z.number(),
    hpBot: z.number(),
    lastClosed: z
      .object({
        player: z.string(),
        dir: dir.nullable(),
        pnlPpm: z.number().int(),
        selfDelta: z.number().int(),
        opponentDelta: z.number().int(),
        penalized: z.boolean(),
      })
      .optional(),
  }),
  [WS_EVENTS.duelResult]: z.object({
    ...base,
    winner: z.string().nullable(),
    ko: z.boolean(),
    pointsAwarded: z.number().int().optional(),
    botSeed: z.string().optional(),
  }),
  [WS_EVENTS.duelVoided]: z.object(base),
  [WS_EVENTS.duelSeed]: z.object({ ...base, seed: z.string() }),
  [WS_EVENTS.duelSnapshot]: z.object({
    duelId: z.string(),
    seq: z.number().int().nonnegative(),
    status: z.enum(['created', 'active', 'finished', 'forfeited', 'voided']),
    fighter: z.string(),
    botLevel: z.number().int().nullable(),
    assetId: z.number().int(),
    startMs: z.number().int().nullable(),
    hp: z.object({ fighter: z.number(), bot: z.number() }),
    positions: z.array(position),
    ticks: z.array(
      z.object({ tickIndex: z.number().int(), price: z.string(), publishMs: z.number().int() }),
    ),
    winner: z.string().nullable(),
    ko: z.boolean(),
  }),
  [WS_EVENTS.seasonLeaderboard]: z.object({
    seasonId: z.number().int(),
    entries: z.array(
      z.object({
        rank: z.number().int(),
        accountId: z.string(),
        points: z.number(),
        wins: z.number().int(),
        duels: z.number().int(),
      }),
    ),
  }),
} as const;

export type EventName = keyof typeof EVENT_SCHEMAS;

export type Sanitized =
  | { ok: true; data: unknown; dropped: string[] }
  | { ok: false; reason: 'unknown-event' | 'malformed' };

/** Parses a message against its schema. `dropped` lists the top level fields that were removed. */
export function sanitizeEvent(event: string, data: unknown): Sanitized {
  const schema = (EVENT_SCHEMAS as Record<string, z.ZodType>)[event];
  if (!schema) return { ok: false, reason: 'unknown-event' };
  const parsed = schema.safeParse(data);
  if (!parsed.success) return { ok: false, reason: 'malformed' };

  const kept = new Set(Object.keys(parsed.data as object));
  const dropped =
    data && typeof data === 'object' ? Object.keys(data).filter((key) => !kept.has(key)) : [];
  return { ok: true, data: parsed.data, dropped };
}
