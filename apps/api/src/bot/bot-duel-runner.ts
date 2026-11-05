import { Dir, type BotLevel } from '@hairto-arena/shared';
import { Logger } from '@nestjs/common';
import { BotBrain, type BrainInit, type BrainState } from './bot-brain.js';
import type { BotGateway } from './bot-gateway.js';
import { positionCommit, positionSalt } from './position-commit.js';
import type { Seed } from './seed.js';
import type { PriceTick } from './strategies/bot-strategy.js';
import type { TickSource } from './tick-feed.js';

export interface RunnerInit extends BrainInit {
  duelId: bigint;
  assetId: number;
  botAccount: string;
}

/** Where the runner keeps what it needs after a restart. */
export interface RunnerStateStore {
  load(duelId: bigint): Promise<BrainState | null>;
  save(duelId: bigint, state: BrainState): Promise<void>;
}

export interface RunnerDeps {
  gateway: BotGateway;
  ticks: TickSource;
  state: RunnerStateStore;
  /** Seconds after the round ends before the runner gives up listening. */
  graceSec?: number;
  onDone?: (duelId: bigint) => void;
}

/** Ticks of history fetched when a runner starts. */
const HISTORY_TICKS = 60;

/**
 * Plays one duel for the bot: listens to ticks, lets `BotBrain` decide, and sends the commit-reveal transactions
 * on the bot's gas key. It checks the on-chain position before acting, so a restart never sends a duplicate open.
 */
export class BotDuelRunner {
  private readonly logger = new Logger(BotDuelRunner.name);
  private readonly brain: BotBrain;
  private readonly level: BotLevel;
  private unsubscribe?: () => void;
  private queue: Promise<void> = Promise.resolve();
  private done = false;

  constructor(
    private readonly init: RunnerInit,
    private readonly deps: RunnerDeps,
  ) {
    this.level = init.level;
    this.brain = new BotBrain(init);
  }

  get finished() {
    return this.done;
  }

  async start() {
    this.brain.preload(await this.deps.ticks.history(this.init.assetId, HISTORY_TICKS));
    await this.recover();
    this.unsubscribe = this.deps.ticks.subscribe(
      this.init.assetId,
      (tick) => void this.handleTick(tick),
    );
  }

  stop() {
    this.done = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** Ticks are handled one at a time and in order, so two transactions of one duel never overlap. */
  handleTick(tick: PriceTick): Promise<void> {
    this.queue = this.queue
      .then(() => this.process(tick))
      .catch((err: Error) => {
        // State only changes after a transaction succeeded, so the next tick simply decides again.
        this.logger.warn(`Duel ${this.init.duelId}: tick ${tick.tickIndex} failed: ${err.message}`);
      });
    return this.queue;
  }

  private async process(tick: PriceTick) {
    if (this.done) return;
    const { duelId, level, botAccount, seed, startMs, config } = this.init;

    if (tick.publishMs > startMs + (config.roundSec + (this.deps.graceSec ?? 5)) * 1000) {
      this.stop();
      this.deps.onDone?.(duelId);
      return;
    }

    const oracleOk = await this.deps.ticks.oracleOk(this.init.assetId);
    const action = this.brain.decide(tick, oracleOk);

    if (action.type === 'open') {
      const onChain = await this.deps.gateway.getPosition(duelId, 'Bot');
      if (onChain?.open) {
        // We believe we are flat but the chain disagrees: resync instead of opening a second position.
        await this.recover();
        return;
      }
      const tradeIndex = this.brain.state.tradesUsed;
      const commit = positionCommit(action.dir, positionSalt(seed, tradeIndex), duelId, botAccount);
      await this.deps.gateway.openPosition(level, duelId, commit);
      this.brain.confirmOpen(action.dir, tick);
      await this.deps.state.save(duelId, this.brain.state);
    } else if (action.type === 'close') {
      const open = this.brain.state.open!;
      await this.deps.gateway.closePosition(
        level,
        duelId,
        open.dir,
        positionSalt(seed, open.tradeIndex),
      );
      this.brain.confirmClose();
      await this.deps.state.save(duelId, this.brain.state);
    }
  }

  /** Makes the local state agree with the chain, which is the source of truth. */
  private async recover() {
    const { duelId, seed, config } = this.init;
    const saved = await this.deps.state.load(duelId);
    if (saved) this.brain.restore(saved);

    const onChain = await this.deps.gateway.getPosition(duelId, 'Bot');
    if (onChain?.open && !this.brain.state.open) {
      // Local state lost: the commit is a hash of (dir, salt, ...) and both are derivable, so find which one it is.
      const found = this.matchCommit(onChain.commit, config.maxTrades + 1, seed);
      if (found) {
        this.brain.restore({
          tradesUsed: Math.max(this.brain.state.tradesUsed, found.tradeIndex + 1),
          open: { dir: found.dir, tradeIndex: found.tradeIndex, openedAt: this.init.startMs },
        });
      } else {
        this.logger.error(
          `Duel ${duelId}: open position does not match any trade derived from the seed`,
        );
      }
    } else if (!onChain?.open && this.brain.state.open) {
      this.brain.restore({ tradesUsed: this.brain.state.tradesUsed, open: null });
    }
    await this.deps.state.save(duelId, this.brain.state);
  }

  private matchCommit(commit: string, trades: number, seed: Seed) {
    const { duelId, botAccount } = this.init;
    for (let tradeIndex = 0; tradeIndex < trades; tradeIndex++) {
      for (const dir of [Dir.Long, Dir.Short] as const) {
        if (positionCommit(dir, positionSalt(seed, tradeIndex), duelId, botAccount) === commit) {
          return { dir, tradeIndex };
        }
      }
    }
    return null;
  }
}
