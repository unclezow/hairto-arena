'use client';

import { useQuery } from '@tanstack/react-query';
import { useNearWallet } from '@/lib/near/context';
import { economyViews } from '@/lib/near/economy';
import { seasonViews } from '@/lib/near/season';

/** Inputs of the economy view, read live from the vault and the arena. */
export interface EconomyInputs {
  tvlA: bigint;
  tvlB: bigint;
  cfgA: { minDeposit: bigint; feeBps: number; ownerShareBps: number };
  cfgB: { minDeposit: bigint; feeBps: number; ownerShareBps: number };
  /** Effective APY in bps per pool (APY × demo time multiplier). */
  rates: [bigint, bigint];
  /** Pending fee plus pot not harvested yet: the vault reports one total for both pools. */
  waiting: [bigint, bigint];
  seconds?: bigint;
  fighterCount?: number;
  backerCount?: number;
  potNow?: bigint;
  funding: bigint;
}

export function useEconomyData() {
  const { config } = useNearWallet();
  return useQuery<EconomyInputs>({
    queryKey: ['economy-inputs', config.contracts.vault, config.contracts.arena],
    refetchInterval: 10_000,
    queryFn: async () => {
      const vault = economyViews(config);
      const season = seasonViews(config);
      const [cfg, totals, funding] = await Promise.all([vault.vaultConfig(), vault.vaultTotals(), season.fundingSeason()]);
      const potNow = funding ? await season.potOf(funding) : undefined;
      const pool = (p: typeof cfg.fighter) => ({
        minDeposit: BigInt(p.min_deposit),
        feeBps: p.fee_bps,
        ownerShareBps: p.owner_share_bps,
      });
      const rate = BigInt(cfg.apy_bps) * BigInt(cfg.time_multiplier);
      return {
        tvlA: BigInt(totals.fighter_principal),
        tvlB: BigInt(totals.backer_principal),
        cfgA: pool(cfg.fighter),
        cfgB: pool(cfg.backer),
        rates: [rate, rate],
        waiting: [BigInt(totals.pending_fee) + BigInt(totals.pending_pot), 0n],
        potNow,
        funding: BigInt(funding),
      };
    },
  });
}
