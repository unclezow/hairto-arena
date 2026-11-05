import { Injectable } from '@nestjs/common';
import type { AccountId } from '@hairto-arena/shared';
import { NearService, type CallResult } from './near.service.js';

export type PoolName = 'Fighter' | 'Backer';

/** `vault.get_account`: role, principal and claimable yield (accrued up to now), all in USDC base units. */
export interface VaultAccountView {
  role: PoolName | null;
  principal: string;
  claimable_yield: string;
}

/** `vault.get_totals`, with fee and pot accrued up to now. */
export interface VaultTotalsView {
  fighter_principal: string;
  backer_principal: string;
  pending_fee: string;
  pending_pot: string;
  pot_held: string;
  payouts_in_flight: number;
}

export interface StorageBalance {
  total: string;
  available: string;
}

/** Typed calls into the vault contract. The keeper signs with its vault function-call key. */
@Injectable()
export class VaultClient {
  constructor(private readonly near: NearService) {}

  get contractId(): AccountId {
    return this.near.contracts.vault;
  }

  private view<T>(method: string, args: object = {}): Promise<T | undefined> {
    return this.near.view<T>(this.contractId, method, args);
  }

  async canPlay(accountId: AccountId): Promise<boolean> {
    return (await this.view<boolean>('can_play', { account_id: accountId })) ?? false;
  }

  async canPick(accountId: AccountId): Promise<boolean> {
    return (await this.view<boolean>('can_pick', { account_id: accountId })) ?? false;
  }

  async getAccount(accountId: AccountId): Promise<VaultAccountView | null> {
    return (
      (await this.view<VaultAccountView | null>('get_account', { account_id: accountId })) ?? null
    );
  }

  async getTotals(): Promise<VaultTotalsView> {
    const totals = await this.view<VaultTotalsView>('get_totals');
    if (!totals) throw new Error('vault.get_totals returned nothing');
    return totals;
  }

  /** Time-weighted average Backer principal over `[fromMs, toMs)`, in base units. */
  async twabOf(accountId: AccountId, fromMs: number, toMs: number): Promise<bigint> {
    const value = await this.view<string>('twab_of', {
      account_id: accountId,
      from_ms: fromMs,
      to_ms: toMs,
    });
    return BigInt(value ?? '0');
  }

  async storageBalanceOf(accountId: AccountId): Promise<StorageBalance | null> {
    return (
      (await this.view<StorageBalance | null>('storage_balance_of', { account_id: accountId })) ??
      null
    );
  }

  /** Keeper: moves accrued fee and pot out of the pools. */
  harvest(): Promise<CallResult<void>> {
    return this.near.call(
      'keeper',
      this.contractId,
      'harvest',
      {},
      { tgas: 100, waitUntil: 'FINAL' },
    );
  }

  /** Keeper: retries payouts the vault still holds. */
  flushPayouts(): Promise<CallResult<void>> {
    return this.near.call(
      'keeper',
      this.contractId,
      'flush_payouts',
      {},
      {
        tgas: 100,
        waitUntil: 'FINAL',
      },
    );
  }
}
