import type { BotLevel, Dir } from '@hairto-arena/shared';
import type { BotConfig } from '../bot-config.js';

export interface PriceTick {
  tickIndex: number;
  price: number;
  /** Publish time in ms. */
  publishMs: number;
}

export interface BotContext {
  /** Ticks up to and including the current one. Never future ticks. */
  ticks: readonly PriceTick[];
  /** Direction of the bot's open position, or null. The bot never sees the fighter's position. */
  openPosition: Dir | null;
  /** Seconds since the round started. */
  elapsedSec: number;
  /** Seconds the open position has been held, or null when flat. */
  heldSec: number | null;
  tradesUsed: number;
  /** Strategy parameters and trade limits, snapshotted when the duel was created. */
  config: BotConfig;
  /** False while the oracle is stale or in outage: the bot must not open a position. */
  oracleOk: boolean;
  /** Seeded PRNG for this tick, so decisions are reproducible after the seed is revealed. */
  random: () => number;
}

export type BotAction =
  { type: 'open'; dir: Dir.Long | Dir.Short } | { type: 'close' } | { type: 'hold' };

export interface BotStrategy {
  readonly level: BotLevel;
  readonly name: string;
  /** Pure: same context (including `random`) gives the same action. */
  decide(ctx: BotContext): BotAction;
}
