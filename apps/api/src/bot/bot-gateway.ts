import { Injectable } from '@nestjs/common';
import { Dir, type AccountId, type BotLevel } from '@hairto-arena/shared';
import { ArenaClient } from '../near/arena.client.js';
import type { ActiveSlot, DuelStatusName, SideName } from '../near/arena.types.js';
import { NearCallError, NearService } from '../near/near.service.js';
import { seedToBase64, type Seed } from './seed.js';

export interface ChainDuel {
  fighter: AccountId;
  bot: AccountId;
  assetId: number;
  botLevel: number;
  season: number;
  /** The Fighter's arena nonce the seed ticket was signed for. */
  nonce: number;
  startMs: number;
  endMs: number;
  /** Round end, or the KO time plus the reveal grace. */
  effectiveEndMs: number;
  status: DuelStatusName;
  /** Base64. */
  seedHash: string;
}

export interface ChainPosition {
  /** Base64. */
  commit: string;
  open: boolean;
  openTick: number;
  trades: number;
}

/** Everything the bot does on-chain. The runner depends on this interface, so tests can fake the chain. */
export interface BotGateway {
  botAccount(level: BotLevel): AccountId;
  openPosition(level: BotLevel, duelId: bigint, commit: string): Promise<void>;
  /** `salt` is 64 hex characters. */
  closePosition(level: BotLevel, duelId: bigint, dir: Dir, salt: string): Promise<void>;
  /** Permissionless: sent from the keeper account and awaited to finality. The arena deletes the duel afterwards. */
  revealSeed(level: BotLevel, duelId: bigint, seed: Seed): Promise<void>;
  getDuel(duelId: bigint): Promise<ChainDuel | null>;
  /** Whether the arena has a tick for the asset recent enough to trade on (`is_stale`). */
  isPriceFresh(assetId: number): Promise<boolean>;
  getPosition(duelId: bigint, side: SideName): Promise<ChainPosition | null>;
  /** What the Fighter has in flight: a duel waiting for the vault answer, or a running duel. */
  activeDuelOf(fighter: AccountId): Promise<ActiveSlot | null>;
  nonceOf(fighter: AccountId): Promise<number>;
  /** Id the arena will give the next duel; every lower id was used. */
  nextDuelId(): Promise<number>;
}

export const BOT_GATEWAY = Symbol('BOT_GATEWAY');

/** Errors of a bot transaction the API can report or the runner can act on. */
export class BotChainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const DIR_NAME = { [Dir.Long]: 'Long', [Dir.Short]: 'Short' } as const;

/** The arena on the bot's own gas key (one nonce lane per concurrent move). */
@Injectable()
export class NearBotGateway implements BotGateway {
  constructor(
    private readonly near: NearService,
    private readonly arena: ArenaClient,
  ) {}

  botAccount(level: BotLevel) {
    return this.near.botAccount(level);
  }

  async openPosition(level: BotLevel, duelId: bigint, commit: string) {
    await this.send(() => this.arena.openPosition(level, duelId, commit));
  }

  async closePosition(level: BotLevel, duelId: bigint, dir: Dir, salt: string) {
    if (dir !== Dir.Long && dir !== Dir.Short)
      throw new BotChainError('BAD_DIRECTION', 'no direction');
    const saltB64 = Buffer.from(salt, 'hex').toString('base64');
    await this.send(() => this.arena.closePosition(level, duelId, DIR_NAME[dir], saltB64));
  }

  async revealSeed(_level: BotLevel, duelId: bigint, seed: Seed) {
    await this.send(() => this.arena.revealBotSeed(duelId, seedToBase64(seed)));
  }

  async getDuel(duelId: bigint): Promise<ChainDuel | null> {
    const duel = await this.arena.getDuel(duelId);
    if (!duel) return null;
    return {
      fighter: duel.fighter,
      bot: duel.bot,
      assetId: duel.asset_id,
      botLevel: duel.bot_level,
      season: duel.season,
      nonce: duel.nonce,
      startMs: duel.start_ms,
      endMs: duel.end_ms,
      effectiveEndMs: duel.effective_end_ms,
      status: duel.status,
      seedHash: duel.seed_hash,
    };
  }

  async isPriceFresh(assetId: number): Promise<boolean> {
    return !(await this.arena.isStale(assetId));
  }

  async getPosition(duelId: bigint, side: SideName): Promise<ChainPosition | null> {
    const p = await this.arena.getPosition(duelId, side);
    if (!p) return null;
    return { commit: p.commit, open: p.open, openTick: p.open_tick, trades: p.trades };
  }

  activeDuelOf(fighter: AccountId) {
    return this.arena.activeDuelOf(fighter);
  }

  nonceOf(fighter: AccountId) {
    return this.arena.nonceOf(fighter);
  }

  async nextDuelId() {
    return (await this.arena.getConfig()).next_duel_id;
  }

  private async send(call: () => Promise<unknown>) {
    try {
      await call();
    } catch (err) {
      if (err instanceof NearCallError) throw new BotChainError('CHAIN_REVERTED', err.message);
      throw new BotChainError('CHAIN_UNAVAILABLE', (err as Error).message);
    }
  }
}
