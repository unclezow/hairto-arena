'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import { readNearBalance } from '@/lib/near/balances';
import { useNearWallet } from '@/lib/near/context';

interface MeStatus {
  role: 'none' | 'fighter' | 'backer';
  canPlay: boolean;
  canPlayReason: 'WRONG_ROLE' | 'BELOW_MINIMUM_DEPOSIT' | null;
}

/** Prepaid gas a duel can use: `start_duel` plus up to four opens and closes. */
export const DUEL_GAS_RESERVE = 150_000_000_000_000_000_000_000n; // 0.15 NEAR

export type ReadinessStep = 'idle' | 'checking' | 'preparing' | 'ready';

export type ReadinessResult =
  | { ok: true }
  | { ok: false; reason: 'WRONG_ROLE' | 'NEEDS_DEPOSIT' | 'NEEDS_GAS' | 'FAILED'; message: string };

/**
 * The check behind BATTLE. It never moves funds: an account below the Fighter minimum is told to deposit (the
 * lobby opens the vault dialog), a Backer is refused, and an account without NEAR for gas is sent to the faucet.
 */
export function useFighterReadiness() {
  const { config, accountId } = useNearWallet();
  const [step, setStep] = useState<ReadinessStep>('idle');

  const ensureReady = useCallback(async (): Promise<ReadinessResult> => {
    if (!accountId) return { ok: false, reason: 'FAILED', message: 'No wallet connected' };
    try {
      setStep('checking');
      const [status, near] = await Promise.all([
        api<MeStatus>('/me/status?live=true'),
        readNearBalance(config, accountId),
      ]);
      setStep('idle');
      if (status.canPlayReason === 'WRONG_ROLE' || status.role === 'backer')
        return { ok: false, reason: 'WRONG_ROLE', message: 'This account is a Backer' };
      if (!status.canPlay)
        return { ok: false, reason: 'NEEDS_DEPOSIT', message: 'Deposit at least 10 USDC to play' };
      if (near < DUEL_GAS_RESERVE)
        return { ok: false, reason: 'NEEDS_GAS', message: 'Add testnet NEAR for gas' };
      setStep('ready');
      return { ok: true };
    } catch (err) {
      setStep('idle');
      return { ok: false, reason: 'FAILED', message: ((err as Error)?.message ?? 'Unknown error').split('\n')[0]! };
    }
  }, [accountId, config]);

  return { step, ensureReady };
}
