import { Injectable } from '@nestjs/common';
import { ArenaClient } from '../near/arena.client.js';
import type { ActiveSlot } from '../near/arena.types.js';
import { VaultClient, type PoolName } from '../near/vault.client.js';

/** The on-chain reads the ticket flow and `/me` need. An interface, so tests do not need a node. */
export interface DuelChainReader {
  /** The account's vault pool (its role), or null when it has none. */
  roleOf(accountId: string): Promise<PoolName | null>;
  /** Fighter principal is at least the Fighter minimum (`vault.can_play`). */
  canPlay(accountId: string): Promise<boolean>;
  /** The nonce the arena expects next in this Fighter's ticket. */
  nonceOf(accountId: string): Promise<number>;
  /** Principal in the vault, read from the chain (the database copy trails), in USDC base units. */
  principalOf(accountId: string): Promise<bigint>;
  /** Yield the account can claim right now, accrued up to now. */
  claimableYieldOf(accountId: string): Promise<bigint>;
  /** What the Fighter has in flight in the arena: a pending or running duel, or null. */
  activeDuelOf(accountId: string): Promise<ActiveSlot | null>;
  currentSeason(): Promise<number>;
}

export const DUEL_CHAIN_READER = Symbol('DUEL_CHAIN_READER');

@Injectable()
export class NearDuelReader implements DuelChainReader {
  constructor(
    private readonly arena: ArenaClient,
    private readonly vault: VaultClient,
  ) {}

  async roleOf(accountId: string) {
    return (await this.vault.getAccount(accountId))?.role ?? null;
  }

  canPlay(accountId: string) {
    return this.vault.canPlay(accountId);
  }

  nonceOf(accountId: string) {
    return this.arena.nonceOf(accountId);
  }

  async principalOf(accountId: string) {
    return BigInt((await this.vault.getAccount(accountId))?.principal ?? '0');
  }

  async claimableYieldOf(accountId: string) {
    return BigInt((await this.vault.getAccount(accountId))?.claimable_yield ?? '0');
  }

  activeDuelOf(accountId: string) {
    return this.arena.activeDuelOf(accountId);
  }

  currentSeason() {
    return this.arena.currentSeason();
  }
}
