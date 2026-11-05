'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNearWallet } from '@/lib/near/context';
import { enableQuickPlay, removeQuickPlay, quickPlayStatus } from '@/lib/near/quick-play-key';

export function useQuickPlayKey() {
  const { accountId, wallet, config } = useNearWallet();
  const queries = useQueryClient();
  const queryKey = ['quick-play-key', config.network, config.contracts.arena, accountId];
  const status = useQuery({ queryKey, queryFn: () => quickPlayStatus(config, accountId!), enabled: !!accountId && !!wallet, refetchInterval: 15_000 });
  const refresh = () => {
    void queries.invalidateQueries({ queryKey });
    void queries.invalidateQueries({ queryKey: ['balances'] });
  };
  const enable = useMutation({
    mutationFn: () => {
      if (!wallet || !accountId) throw new Error('Connect your wallet first.');
      return enableQuickPlay(config, accountId, wallet);
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => {
      if (!wallet || !accountId) throw new Error('Connect your wallet first.');
      return removeQuickPlay(config, accountId, wallet);
    },
    onSuccess: refresh,
  });
  return { status, enable, remove };
}
