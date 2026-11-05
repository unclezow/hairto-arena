'use client';

import { useQuery } from '@tanstack/react-query';
import { featureReady, featureUnavailable } from '@/lib/features';
import { api, ApiError } from '@/lib/api';
import { useWalletSession } from './use-wallet-session';

export type OnchainKind =
  | 'created'
  | 'opened'
  | 'closed'
  | 'penalized'
  | 'finished'
  | 'forfeited'
  | 'voided'
  | 'seed_revealed';

export interface OnchainStep {
  kind: OnchainKind;
  side: 'fighter' | 'bot' | null;
  txHash: string;
  at: string;
  dir: 'LONG' | 'SHORT' | null;
  pnlPpm: number | null;
  /** HP change applied to the actor and to the opponent (negative = HP lost). */
  selfDelta: number | null;
  opponentDelta: number | null;
}

export interface DuelOnchain {
  arena: string;
  txs: OnchainStep[];
}

/** The transactions behind a duel, read from the API's indexer mirror; `live` keeps polling while it runs. */
export function useDuelOnchain(duelId: string | null, live: boolean) {
  const { accountId: address, token } = useWalletSession();
  return useQuery({
    queryKey: ['duel', duelId, 'onchain', address, token],
    queryFn: ({ signal }) => { if (!featureReady('duel')) return featureUnavailable('duel'); return api<DuelOnchain>(`/duels/${duelId}/onchain`, { signal }); },
    enabled: featureReady('duel') && !!duelId && !!token,
    retry: false,
    refetchInterval: (query) => {
      if (
        query.state.error instanceof ApiError &&
        [401, 403, 404].includes(query.state.error.status)
      )
        return false;
      const txs = query.state.data?.txs ?? [];
      const terminal = txs.some((step) => ['finished', 'forfeited', 'voided'].includes(step.kind));
      const revealed = txs.some((step) => step.kind === 'seed_revealed');
      return live || !terminal || !revealed ? 2000 : false;
    },
  });
}
