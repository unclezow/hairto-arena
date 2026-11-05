export interface Tier {
  /** First and last rank of the tier, inclusive. */
  from: number;
  to: number;
  /** Share of the Fighter prize pool each rank of the tier gets, in basis points. */
  bps: number;
}

/** Consecutive ranks with the same share form a tier: 1, 2, 3, 4, 5, then 6-10, then 11-20. */
export function tiersOf(curve: readonly number[]): Tier[] {
  const tiers: Tier[] = [];
  curve.forEach((bps, i) => {
    const rank = i + 1;
    const last = tiers.at(-1);
    if (last && last.bps === bps) last.to = rank;
    else tiers.push({ from: rank, to: rank, bps });
  });
  return tiers;
}

export function tierOf(curve: readonly number[], rank: number): Tier | null {
  return tiersOf(curve).find((t) => rank >= t.from && rank <= t.to) ?? null;
}

/** The tier right above the one `rank` is in, or null for rank 1 or an unranked position. */
export function nextBetterTier(curve: readonly number[], rank: number): Tier | null {
  const tiers = tiersOf(curve);
  const index = tiers.findIndex((t) => rank >= t.from && rank <= t.to);
  if (index > 0) return tiers[index - 1]!;
  // Below the last prize rank: the best way in is the lowest paid tier.
  return index === -1 && tiers.length > 0 ? tiers.at(-1)! : null;
}

export const prizeBpsOf = (curve: readonly number[], rank: number): number => curve[rank - 1] ?? 0;
