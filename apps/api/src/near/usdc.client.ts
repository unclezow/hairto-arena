import { Injectable } from '@nestjs/common';
import type { AccountId } from '@hairto-arena/shared';
import type { StorageBalance } from './vault.client.js';
import { NearService } from './near.service.js';

/** `usdc.faucet_info`: amount per claim, cooldown, and when the account may claim next. */
export interface FaucetInfo {
  faucet_amount: string;
  faucet_cooldown_ms: number;
  next_claim_ms: number;
}

/** Read-only calls into the USDC (NEP-141) contract, for balances and onboarding status. */
@Injectable()
export class UsdcClient {
  constructor(private readonly near: NearService) {}

  get contractId(): AccountId {
    return this.near.contracts.usdc;
  }

  async balanceOf(accountId: AccountId): Promise<bigint> {
    const value = await this.near.view<string>(this.contractId, 'ft_balance_of', {
      account_id: accountId,
    });
    return BigInt(value ?? '0');
  }

  async storageBalanceOf(accountId: AccountId): Promise<StorageBalance | null> {
    return (
      (await this.near.view<StorageBalance | null>(this.contractId, 'storage_balance_of', {
        account_id: accountId,
      })) ?? null
    );
  }

  async faucetInfo(accountId: AccountId): Promise<FaucetInfo | null> {
    return (
      (await this.near.view<FaucetInfo>(this.contractId, 'faucet_info', {
        account_id: accountId,
      })) ?? null
    );
  }
}
