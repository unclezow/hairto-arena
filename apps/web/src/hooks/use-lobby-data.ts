'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import type { CharacterView } from '@hairto-arena/shared';
import { api } from '@/lib/api';
import { characterViews, purchaseRejectionText } from '@/lib/near/characters';
import { useNearWallet } from '@/lib/near/context';
import { eventsOf, findEvent } from '@/lib/near/outcome';
import { ONE_YOCTO, walletSend } from '@/lib/near/tx';
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
const STORE_IDS = ['1', '2', '3', '4'];
const EQUIP_DEBOUNCE_MS = 1200;

/**
 * Owned and equipped characters of the connected account, read from the characters contract so they are fresh
 * right after a purchase. Selecting an owned character equips it through the wallet, debounced so flicking through
 * the roster sends one transaction.
 */
export function useOwnedCharacters() {
  const { config, accountId, wallet } = useNearWallet();
  const queryClient = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const query = useQuery({
    queryKey: ['wallet-characters', config.contracts.characters, accountId],
    enabled: !!accountId,
    queryFn: async () => {
      const views = characterViews(config);
      const [balances, equipped] = await Promise.all([views.balances(accountId!, STORE_IDS), views.equippedOf(accountId!)]);
      return {
        owned: [0, ...STORE_IDS.filter((_, i) => (balances[i] ?? 0n) > 0n).map(Number)],
        equipped: Number(equipped),
      };
    },
  });
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const owns = useCallback((id: number) => query.data?.owned.includes(id) ?? false, [query.data]);
  const equip = useCallback(
    (id: number) => {
      if (timer.current) clearTimeout(timer.current);
      if (!query.data || !owns(id) || query.data.equipped === id || !accountId || !wallet) return;
      timer.current = setTimeout(() => {
        void walletSend(config, accountId, wallet, [
          { receiverId: config.contracts.characters, method: 'equip', args: { token_id: String(id) }, gasTgas: 30, deposit: '0' },
        ])
          // Declined or failed: the carousel keeps the local preview; the next duel uses the old one.
          .catch(() => undefined)
          .finally(() => void queryClient.invalidateQueries({ queryKey: ['wallet-characters'] }));
      }, EQUIP_DEBOUNCE_MS);
    },
    [accountId, config, owns, query.data, queryClient, wallet],
  );
  return {
    owned: query.data?.owned ?? null,
    equipped: query.data?.equipped ?? null,
    walletKey: query.data ? accountId : null,
    owns,
    equip,
  };
}

/** Catalog from the chain (prices, supply, active) and the USDC purchase through `ft_transfer_call`. */
export function useCharacterStore() {
  const { config, accountId, wallet } = useNearWallet();
  const queryClient = useQueryClient();
  const catalog = useQuery({
    queryKey: ['chain-characters', config.contracts.characters],
    queryFn: () => characterViews(config).getCharacters(),
    staleTime: 30_000,
  });
  const buy = useCallback(
    async (id: number): Promise<string | null> => {
      if (!accountId || !wallet) return 'Sign in first';
      const fresh = await characterViews(config).getCharacter(String(id));
      if (!fresh || !fresh.active) return 'This character is not for sale.';
      const outcomes = await walletSend(config, accountId, wallet, [
        {
          receiverId: config.contracts.usdc,
          method: 'ft_transfer_call',
          args: { receiver_id: config.contracts.characters, amount: fresh.price, msg: JSON.stringify({ buy: String(id) }) },
          gasTgas: 100,
          deposit: ONE_YOCTO,
        },
      ]);
      await queryClient.invalidateQueries({ queryKey: ['wallet-characters'] });
      await queryClient.invalidateQueries({ queryKey: ['chain-characters'] });
      const events = outcomes.flatMap((o) => eventsOf(o, config.contracts.characters));
      const rejected = findEvent(events, 'purchase_rejected');
      if (rejected) return purchaseRejectionText(rejected.reason);
      return findEvent(events, 'character_purchased') ? null : 'The purchase was not confirmed.';
    },
    [accountId, config, queryClient, wallet],
  );
  return {
    byId: (id: number) => catalog.data?.find((c) => c.token_id === String(id)),
    buy,
  };
}
