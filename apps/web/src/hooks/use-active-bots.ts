'use client';

import type { BotLevel } from '@hairto-arena/shared';
import { useQuery } from '@tanstack/react-query';
import { viewClient } from '@/lib/near/client';
import { useNearWallet } from '@/lib/near/context';

interface BotView {
  level: number;
  account_id: string;
  active: boolean;
}

/** Levels 1 to 3 until the chain answers, so the lobby never starts empty. */
const FALLBACK: BotLevel[] = [1, 2, 3];

/** Bot levels the arena reports as configured and active (`get_bots`), in ascending order, with their accounts. */
export function useActiveBots() {
  const { config } = useNearWallet();
  const bots = useQuery({
    queryKey: ['arena-bots', config.contracts.arena],
    queryFn: () => viewClient(config).view<BotView[]>(config.contracts.arena, 'get_bots', {}),
    staleTime: 60_000,
  });
  const active = (bots.data ?? [])
    .filter((b) => b.active && b.level >= 1 && b.level <= 4)
    .sort((a, b) => a.level - b.level);
  return {
    levels: bots.data ? active.map((b) => b.level as BotLevel) : FALLBACK,
    accountOf: (level: BotLevel) => active.find((b) => b.level === level)?.account_id ?? null,
  };
}
