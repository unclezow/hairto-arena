'use client';

import { STABLE_DECIMALS, VAULTS } from '@hairto-arena/shared';
import { parseUnits } from '@/lib/amount';
import { featureReady } from '@/lib/features';
import { useBalances } from './use-balances';

export type VaultAction = 'claim' | 'deposit' | 'withdraw';
export const FIGHTER_MINIMUM = parseUnits(String(VAULTS.fighter.minDepositUsd), STABLE_DECIMALS);
/** near-web-economy replaces this fence. No transaction or success is simulated. */
export function useVault() {
  const balances = useBalances();
  const unavailable = async (amount?: bigint) => { void amount; void featureReady('economy'); return false; };
  return { wallet: balances.usdc, principal: 0n, yieldEarned: 0n, nextClaimAt: 0, canPlay: false, busy: null as VaultAction | null, error: null as string | null, claim: unavailable, deposit: unavailable, withdraw: unavailable };
}
