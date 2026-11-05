import type { BotLevel } from '@hairto-arena/shared';
import { Dir } from '@hairto-arena/shared';
import {
  BotChainError,
  type BotGateway,
  type ChainDuel,
  type ChainPosition,
} from '../../src/bot/bot-gateway.js';
import type { BrainState } from '../../src/bot/bot-brain.js';
import type { RunnerStateStore } from '../../src/bot/bot-duel-runner.js';
import { positionCommit } from '../../src/bot/position-commit.js';
import { hashSeed, type Seed } from '../../src/bot/seed.js';
import type { PriceTick } from '../../src/bot/strategies/bot-strategy.js';
import type { TickSource } from '../../src/bot/tick-feed.js';
import type { ActiveSlot } from '../../src/near/arena.types.js';

export const BOT_ACCOUNT: Record<BotLevel, string> = {
  1: 'rookie.bots.hairto.testnet',
  2: 'trend.bots.hairto.testnet',
  3: 'reversion.bots.hairto.testnet',
  4: 'oracle.bots.hairto.testnet',
};

interface FakeDuel extends ChainDuel {
  positions: Map<'Fighter' | 'Bot', ChainPosition>;
  revealed: Seed | null;
}

/**
 * An in-memory arena that enforces what the real one will: a commit must match on close, a seed must hash to the
 * value of the ticket, one open position per side.
 */
export class FakeBotGateway implements BotGateway {
  duels = new Map<bigint, FakeDuel>();
  nextId = 1n;
  startMs = 1_000_000;
  currentTick = 0;
  calls: { fn: string; duelId?: bigint }[] = [];
  /** Throw this from the next call of the named function. */
  failNext = new Map<string, Error>();
  /** Assets the fake arena reports as stale; everything else is fresh. */
  staleAssets = new Set<number>();
  /** What `active_duel_of` answers per Fighter. */
  slots = new Map<string, ActiveSlot>();
  nonces = new Map<string, number>();

  botAccount(level: BotLevel) {
    return BOT_ACCOUNT[level];
  }

  private maybeFail(fn: string) {
    const err = this.failNext.get(fn);
    if (err) {
      this.failNext.delete(fn);
      throw err;
    }
  }

  /** What the Fighter's `start_duel` does once the vault said yes. */
  startDuel(input: { level: BotLevel; fighter: string; assetId: number; seedHash: string }) {
    const nonce = this.nonces.get(input.fighter) ?? 0;
    const duelId = this.nextId++;
    this.duels.set(duelId, {
      fighter: input.fighter,
      bot: BOT_ACCOUNT[input.level],
      assetId: input.assetId,
      botLevel: input.level,
      season: 1,
      nonce,
      startMs: this.startMs,
      endMs: this.startMs + 30_000,
      effectiveEndMs: this.startMs + 30_000,
      status: 'Active',
      seedHash: input.seedHash,
      positions: new Map(),
      revealed: null,
    });
    this.nonces.set(input.fighter, nonce + 1);
    this.slots.set(input.fighter, { Active: { duel_id: Number(duelId) } });
    return duelId;
  }

  private duel(id: bigint) {
    const d = this.duels.get(id);
    if (!d) throw new BotChainError('CHAIN_REVERTED', 'unknown duel');
    return d;
  }

  async openPosition(_level: BotLevel, duelId: bigint, commit: string) {
    this.calls.push({ fn: 'openPosition', duelId });
    this.maybeFail('openPosition');
    const d = this.duel(duelId);
    if (d.positions.get('Bot')?.open)
      throw new BotChainError('CHAIN_REVERTED', 'position already open');
    const trades = (d.positions.get('Bot')?.trades ?? 0) + 1;
    d.positions.set('Bot', { commit, open: true, openTick: this.currentTick, trades });
  }

  async closePosition(_level: BotLevel, duelId: bigint, dir: Dir, salt: string) {
    this.calls.push({ fn: 'closePosition', duelId });
    this.maybeFail('closePosition');
    const d = this.duel(duelId);
    const position = d.positions.get('Bot');
    if (!position?.open) throw new BotChainError('CHAIN_REVERTED', 'no open position');
    if (dir !== Dir.Long && dir !== Dir.Short)
      throw new BotChainError('CHAIN_REVERTED', 'no direction');
    if (positionCommit(dir, salt, duelId, d.bot) !== position.commit) {
      throw new BotChainError('CHAIN_REVERTED', 'commit mismatch');
    }
    d.positions.set('Bot', { ...position, open: false });
  }

  async revealSeed(_level: BotLevel, duelId: bigint, seed: Seed) {
    this.calls.push({ fn: 'revealSeed', duelId });
    this.maybeFail('revealSeed');
    const d = this.duel(duelId);
    if (hashSeed(seed, d.fighter, d.nonce) !== d.seedHash)
      throw new BotChainError('CHAIN_REVERTED', 'seed mismatch');
    if (d.revealed) throw new BotChainError('CHAIN_REVERTED', 'unknown duel');
    d.revealed = seed;
  }

  async isPriceFresh(assetId: number) {
    this.calls.push({ fn: 'isPriceFresh' });
    return !this.staleAssets.has(assetId);
  }

  async getDuel(duelId: bigint): Promise<ChainDuel | null> {
    const d = this.duels.get(duelId);
    if (!d) return null;
    const { positions: _p, revealed: _r, ...duel } = d;
    return duel;
  }

  async getPosition(duelId: bigint, side: 'Fighter' | 'Bot'): Promise<ChainPosition | null> {
    return this.duel(duelId).positions.get(side) ?? null;
  }

  async activeDuelOf(fighter: string) {
    return this.slots.get(fighter) ?? null;
  }

  async nonceOf(fighter: string) {
    return this.nonces.get(fighter) ?? 0;
  }

  count(fn: string) {
    return this.calls.filter((c) => c.fn === fn).length;
  }

  finish(duelId: bigint, status: ChainDuel['status'] = 'Finished') {
    const d = this.duel(duelId);
    d.status = status;
    this.slots.delete(d.fighter);
  }
}

/** A tick source the test drives by hand. */
export class ManualTicks implements TickSource {
  private listeners = new Set<(t: PriceTick) => void>();
  past: PriceTick[] = [];
  oracleHealthy = true;

  subscribe(_assetId: number, listener: (t: PriceTick) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  async history(_assetId: number, count: number) {
    return this.past.slice(-count);
  }

  async oracleOk() {
    return this.oracleHealthy;
  }

  get subscribers() {
    return this.listeners.size;
  }

  /** Delivers a tick to every listener and waits for them to finish. */
  async emit(tick: PriceTick, handlers: { handleTick(t: PriceTick): Promise<void> }[]) {
    await Promise.all(handlers.map((h) => h.handleTick(tick)));
  }
}

export class MemoryRunnerState implements RunnerStateStore {
  states = new Map<bigint, BrainState>();
  async load(duelId: bigint) {
    const s = this.states.get(duelId);
    return s ? { tradesUsed: s.tradesUsed, open: s.open ? { ...s.open } : null } : null;
  }
  async save(duelId: bigint, state: BrainState) {
    this.states.set(duelId, {
      tradesUsed: state.tradesUsed,
      open: state.open ? { ...state.open } : null,
    });
  }
}

/** A steady climb: 1 bp per tick from 100, one tick per second. The Trend bot reads this as a clear uptrend. */
export const climbingTick = (second: number, startMs = 1_000_000): PriceTick => ({
  tickIndex: second + 1,
  price: 100 * (1 + second * 0.0001),
  publishMs: startMs + second * 1000,
});
