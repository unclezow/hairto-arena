'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { STABLE_DECIMALS } from '@hairto-arena/shared';
import { useNearWallet } from '@/lib/near/context';
import { readNearBalance, readUsdcBalance } from '@/lib/near/balances';
import { formatAmount } from '@/lib/amount';
export { formatAmount } from '@/lib/amount';

export function useBalances(pollInterval = 15_000) {
  const { accountId, config } = useNearWallet();
  const queries = useQueryClient();
  const near = useQuery({
    queryKey: ['balances', 'near', config.network, config.rpcUrl, accountId],
    queryFn: () => readNearBalance(config, accountId!),
    enabled: !!accountId,
    refetchInterval: pollInterval,
  });
  const usdc = useQuery({
    queryKey: ['balances', 'usdc', config.network, config.rpcUrl, config.contracts.usdc, accountId],
    queryFn: () => readUsdcBalance(config, accountId!),
    enabled: !!accountId,
    refetchInterval: 15_000,
  });
  useEffect(() => {
    const refresh = () => { void queries.invalidateQueries({ queryKey: ['balances'] }); };
    window.addEventListener('hairto:transaction', refresh);
    return () => window.removeEventListener('hairto:transaction', refresh);
  }, [queries]);
  return {
    near: near.data ?? 0n,
    usdc: usdc.data ?? 0n,
    nearText: formatAmount(near.data ?? 0n, 24),
    usdcText: formatAmount(usdc.data ?? 0n, STABLE_DECIMALS),
    nearQuery: near,
    usdcQuery: usdc,
    refresh: async () => { await Promise.all([near.refetch(), usdc.refetch()]); },
  };
}
