import type { RankedFighter } from './ranking.js';

const BPS = 10_000n;

export interface Prize {
  address: string;
  rank: number;
  amount: bigint;
}

/**
 * Fighter prizes from the Fighter pool by the prize curve. Each share is floored, so the total never
 * exceeds the pool. Ranks beyond the curve get nothing, and when fewer fighters qualify than the curve has
 * ranks, the shares nobody fills are left unpaid: they are not redistributed, they roll over.
 */
export function prizeAmounts(
  fighterPool: bigint,
  curveBps: readonly number[],
  ranked: readonly RankedFighter[],
): Prize[] {
  return ranked
    .slice(0, curveBps.length)
    .map((f) => ({
      address: f.address,
      rank: f.rank,
      amount: (fighterPool * BigInt(curveBps[f.rank - 1]!)) / BPS,
    }))
    .filter((p) => p.amount > 0n);
}
