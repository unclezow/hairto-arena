'use client';

import { featureReady } from '@/lib/features';
import { useBalances } from './use-balances';

/** near-web-economy adds actual vault/yield/claim totals. Wallet funds stay separate. */
export function useGameAssets() {
  const balances = useBalances();
  void featureReady('economy');
  return { deposit: 0n, yieldEarned: 0n, prizes: 0n, wallet: balances.usdc, total: 0n, totalText: '0' };
}
