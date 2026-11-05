'use client';

import { STABLE_DECIMALS } from '@hairto-arena/shared';
import { useQuery } from '@tanstack/react-query';
import { formatAmount } from '@/lib/amount';
import { api } from '@/lib/api';
import { useVault } from './use-vault';
import { useWalletSession } from './use-wallet-session';

interface FighterSummary {
  prizesClaimable: { amount: string | number }[];
}

const toBigInt = (value: string | number): bigint => {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
};

/**
 * What the account has in the game: its Fighter pool deposit, the yield it can claim and season prizes not yet
 * claimed (the lobby's USDC chip). The wallet's own USDC is separate and only shown in the chip's details.
 */
export function useGameAssets() {
  const { token } = useWalletSession();
  const vault = useVault('Fighter');
  // Accounts that are not Fighters get a 403 here: they simply have no prizes.
  const summary = useQuery({
    queryKey: ['me-fighter', token],
    queryFn: () => api<FighterSummary>('/me/fighter'),
    enabled: !!token,
    retry: false,
  });
  const prizes = (summary.data?.prizesClaimable ?? []).reduce((sum, p) => sum + toBigInt(p.amount), 0n);
  const total = vault.principal + vault.yieldEarned + prizes;
  return {
    deposit: vault.principal,
    yieldEarned: vault.yieldEarned,
    prizes,
    wallet: vault.wallet,
    total,
    totalText: formatAmount(total, STABLE_DECIMALS),
  };
}
