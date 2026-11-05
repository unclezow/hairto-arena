import type { BotLevel, Dir } from '@hairto-arena/shared';
import type { BotConfig } from './bot-config.js';
import { decideWithLimits, tickRandom } from './decide.js';
import type { Seed } from './seed.js';
import { STRATEGIES } from './strategies/index.js';
import type { BotAction, PriceTick } from './strategies/bot-strategy.js';

export interface OpenTrade {
  dir: Dir;
  /** 0 based; picks the salt of the commit. */
  tradeIndex: number;
  /** Publish time (ms) of the tick the bot opened on. */
  openedAt: number;
}

export interface BrainState {
  tradesUsed: number;
  open: OpenTrade | null;
}

export interface BrainInit {
  level: BotLevel;
  config: BotConfig;
  seed: Seed;
  /** Unix ms the round starts (the arena duel's `start_ms`). Ticks before it are history only. */
  startMs: number;
}

/** History kept for the strategies. The longest window in use is far shorter. */
const MAX_HISTORY = 200;

/**
 * The bot's whole decision logic, without any I/O. The runner drives it with live ticks and the audit routine
 * replays stored ticks through the very same class, so what is verified is what ran.
 */
export class BotBrain {
  private readonly ticks: PriceTick[] = [];
  state: BrainState = { tradesUsed: 0, open: null };

  constructor(private readonly init: BrainInit) {
    if (!STRATEGIES[init.level]) throw new Error(`No strategy for bot level ${init.level}`);
  }

  /** Seeds the history before the round (for example the ticks that arrived before the bot started). */
  preload(ticks: readonly PriceTick[]) {
    for (const t of ticks) this.remember(t);
  }

  restore(state: BrainState) {
    this.state = { tradesUsed: state.tradesUsed, open: state.open ? { ...state.open } : null };
  }

  /** Decides on a tick. Only ticks up to and including this one are visible. */
  decide(tick: PriceTick, oracleOk: boolean): BotAction {
    this.remember(tick);
    const elapsedSec = (tick.publishMs - this.init.startMs) / 1000;
    if (elapsedSec < 0) return { type: 'hold' };

    const { open } = this.state;
    return decideWithLimits(STRATEGIES[this.init.level]!, {
      ticks: this.ticks,
      openPosition: open?.dir ?? null,
      elapsedSec,
      heldSec: open ? (tick.publishMs - open.openedAt) / 1000 : null,
      tradesUsed: this.state.tradesUsed,
      config: this.init.config,
      oracleOk,
      random: tickRandom(this.init.seed, tick.tickIndex),
    });
  }

  /** Call after the open transaction succeeded. Returns the trade, whose index picks the commit salt. */
  confirmOpen(dir: Dir, tick: PriceTick): OpenTrade {
    const trade: OpenTrade = { dir, tradeIndex: this.state.tradesUsed, openedAt: tick.publishMs };
    this.state = { tradesUsed: this.state.tradesUsed + 1, open: trade };
    return trade;
  }

  confirmClose() {
    this.state = { ...this.state, open: null };
  }

  private remember(tick: PriceTick) {
    const last = this.ticks[this.ticks.length - 1];
    if (last && tick.tickIndex <= last.tickIndex) return;
    this.ticks.push(tick);
    if (this.ticks.length > MAX_HISTORY) this.ticks.shift();
  }
}

export interface ReplayedTrade {
  tradeIndex: number;
  dir: Dir;
  openedAtTick: number;
  closedAtTick: number | null;
}

/**
 * What the bot would do on these ticks, assuming a healthy oracle throughout. Used to check a revealed seed
 * against the positions the bot actually took.
 */
export function reproduceBotTrades(init: BrainInit, ticks: readonly PriceTick[]): ReplayedTrade[] {
  const brain = new BotBrain(init);
  const trades: ReplayedTrade[] = [];
  for (const tick of ticks) {
    const action = brain.decide(tick, true);
    if (action.type === 'open') {
      const trade = brain.confirmOpen(action.dir, tick);
      trades.push({
        tradeIndex: trade.tradeIndex,
        dir: action.dir,
        openedAtTick: tick.tickIndex,
        closedAtTick: null,
      });
    } else if (action.type === 'close') {
      brain.confirmClose();
      trades[trades.length - 1]!.closedAtTick = tick.tickIndex;
    }
  }
  return trades;
}
