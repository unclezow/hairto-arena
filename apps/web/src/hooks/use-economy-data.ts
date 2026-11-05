'use client';

import { useQuery } from '@tanstack/react-query';
import { featureReady, featureUnavailable } from '@/lib/features';

/** Inputs required by the preserved economy view; populated in near-web-economy. */
export interface EconomyInputs {
  tvlA: bigint;
  tvlB: bigint;
  cfgA: { minDeposit: bigint; feeBps: number; ownerShareBps: number };
  cfgB: { minDeposit: bigint; feeBps: number; ownerShareBps: number };
  rates: [bigint, bigint];
  waiting: [bigint, bigint];
  seconds?: bigint;
  fighterCount?: number;
  backerCount?: number;
  potNow?: bigint;
  funding: bigint;
}
export function useEconomyData() {
  return useQuery<EconomyInputs>({ queryKey: ['economy-inputs'], enabled: featureReady('economy'), queryFn: async () => featureUnavailable('economy') });
}
