'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useWalletSession } from './use-wallet-session';

export interface HistoryMatch {
  id: string;
  status: 'CREATED' | 'ACTIVE' | 'FINISHED' | 'FORFEITED' | 'VOIDED';
  fighter: string;
  bot: { name: string; level: number };
  assetId: number;
  startAt: string | null;
  winner: string | null;
  pointsAwarded: number | null;
  counted: boolean | null;
}

interface HistoryPage {
  items: HistoryMatch[];
  nextCursor: string | null;
}

export function useMatchHistory() {
  const { accountId: address, token } = useWalletSession();
  return useInfiniteQuery({
    queryKey: ['me', 'match-history', address, token],
    queryFn: ({ pageParam, signal }) =>
      api<HistoryPage>(
        `/me/duels?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!address && !!token,
    refetchInterval: 15_000,
  });
}
