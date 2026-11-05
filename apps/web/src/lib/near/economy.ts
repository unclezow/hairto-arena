import { viewClient } from './client';
import type { NearConfig } from './config';

export type Pool = 'Fighter' | 'Backer';

export interface FaucetInfo {
  faucet_amount: string;
  faucet_cooldown_ms: number;
  /** ms; 0 when never claimed. */
  next_claim_ms: number;
}
export interface PoolConfig {
  min_deposit: string;
  fee_bps: number;
  owner_share_bps: number;
}
export interface VaultConfig {
  paused: boolean;
  apy_bps: number;
  time_multiplier: number;
  fighter: PoolConfig;
  backer: PoolConfig;
}
export interface VaultTotals {
  fighter_principal: string;
  backer_principal: string;
  pending_fee: string;
  pending_pot: string;
  pot_held: string;
}

const view = async <T>(config: NearConfig, contract: string, method: string, args: object = {}): Promise<T> =>
  (await viewClient(config).view<T>(contract, method, args)) as T;

/** Typed views of the USDC (mock) token and the vault. */
export const economyViews = (config: NearConfig) => ({
  faucetInfo: (accountId: string) => view<FaucetInfo>(config, config.contracts.usdc, 'faucet_info', { account_id: accountId }),
  usdcRegistered: async (accountId: string) =>
    (await view<unknown>(config, config.contracts.usdc, 'storage_balance_of', { account_id: accountId })) != null,
  usdcStorageMin: async () =>
    (await view<{ min: string }>(config, config.contracts.usdc, 'storage_balance_bounds')).min,
  vaultRegistered: async (accountId: string) =>
    (await view<unknown>(config, config.contracts.vault, 'storage_balance_of', { account_id: accountId })) != null,
  roleOf: (accountId: string) => view<Pool | null>(config, config.contracts.vault, 'role_of', { account_id: accountId }),
  principalOf: async (pool: Pool, accountId: string) =>
    BigInt(await view<string>(config, config.contracts.vault, 'principal_of', { pool, account_id: accountId })),
  claimableYieldOf: async (accountId: string) =>
    BigInt(await view<string>(config, config.contracts.vault, 'claimable_yield_of', { account_id: accountId })),
  vaultConfig: () => view<VaultConfig>(config, config.contracts.vault, 'get_config'),
  vaultTotals: () => view<VaultTotals>(config, config.contracts.vault, 'get_totals'),
});

/** The vault charges this once to register an account. */
export const VAULT_REGISTRATION_NEAR = '0.01';
