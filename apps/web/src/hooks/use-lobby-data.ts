'use client';

import { useQuery } from '@tanstack/react-query';
import type { CharacterView } from '@hairto-arena/shared';
import { api } from '@/lib/api';
import { featureReady, featureUnavailable } from '@/lib/features';
import { useWalletSession } from './use-wallet-session';

export interface MyStanding { rank: number | null; points: number; duels: number; duelsToQualify: number }
export interface RankedFighter { rank: number; address: string; points: number; wins: number; duels: number }
export const shortAddress = (accountId: string) => accountId.length > 20 ? `${accountId.slice(0, 10)}…${accountId.slice(-8)}` : accountId;
export const avatarSeed = (accountId: string) => [...accountId].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) % 8, 0);
export function useMyStanding() {
  const { token, accountId } = useWalletSession();
  return useQuery({ queryKey: ['leaderboard', 'me', accountId, token], queryFn: ({ signal }) => api<MyStanding>('/leaderboard/me', { signal }), enabled: !!token });
}
export interface MyDaily { played: number; cap: number | null; resetsAt: string }
export function useMyDaily() {
  const { token, accountId } = useWalletSession();
  return useQuery({ queryKey: ['me', 'daily', accountId, token], queryFn: ({ signal }) => api<MyDaily>('/me/daily', { signal }), enabled: !!token, refetchInterval: 30_000 });
}
export function useLeaderboard() {
  return useQuery({ queryKey: ['leaderboard'], queryFn: ({ signal }) => api<{ items: RankedFighter[]; minDuels?: number }>('/leaderboard?limit=8', { signal }), staleTime: 15_000 });
}
export function useCharacterCatalog() {
  return useQuery({ queryKey: ['characters'], queryFn: ({ signal }) => api<{ items: CharacterView[] }>('/characters', { signal }) });
}
export function useOwnedCharacters() {
  const { accountId, token } = useWalletSession();
  const query = useQuery({ queryKey: ['wallet-characters', accountId], queryFn: ({ signal }) => api<{ owned: number[]; equipped: number }>(`/wallets/${accountId}/characters`, { signal }), enabled: !!accountId && !!token });
  return {
    owned: query.data?.owned ?? null,
    equipped: query.data?.equipped ?? null,
    walletKey: query.data ? accountId : null,
    owns: (id: number) => query.data?.owned.includes(id) ?? false,
    equip: (id: number) => { void id; if (featureReady('economy')) featureUnavailable('economy'); },
  };
}
