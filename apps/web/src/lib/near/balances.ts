import { AccountDoesNotExistError } from 'near-kit';
import { viewClient } from './client';
import type { NearConfig } from './config';

/** Exact spendable yoctoNEAR; near-kit getBalance rounds its decimal display to two places. */
export function availableNear(account: { amount: string; locked: string; storage_usage: number }): bigint {
  const reserved = 10n ** 19n * BigInt(account.storage_usage) - BigInt(account.locked);
  const liquid = BigInt(account.amount);
  return reserved <= 0n ? liquid : reserved >= liquid ? 0n : liquid - reserved;
}
export async function readNearBalance(config: NearConfig, accountId: string) {
  try { return availableNear(await viewClient(config).rpc.getAccount(accountId)); }
  catch (error) { if (error instanceof AccountDoesNotExistError) return 0n; throw error; }
}
export async function readUsdcBalance(config: NearConfig, accountId: string) {
  const amount = await viewClient(config).view<string>(config.contracts.usdc, 'ft_balance_of', { account_id: accountId });
  if (typeof amount !== 'string') throw new Error('Could not read your USDC balance.');
  return BigInt(amount);
}
