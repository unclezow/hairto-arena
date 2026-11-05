export interface ScoreInput {
  address: string;
  points: number;
  wins: number;
  duels: number;
  /** Unix seconds the current point total was reached: the third tie-breaker. */
  reachedAt: number | null;
}

export interface RankedFighter {
  rank: number;
  address: string;
  points: number;
  wins: number;
  duels: number;
}

/**
 * The season ranking: only fighters with at least `minDuels` duels count, ordered by points, then wins,
 * then who reached the score first, then address. The last key only exists to make the order total, so the same
 * data always gives the same ranking.
 */
export function rankFighters(scores: readonly ScoreInput[], minDuels: number): RankedFighter[] {
  return scores
    .filter((s) => s.duels >= minDuels)
    .slice()
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.wins - a.wins ||
        (a.reachedAt ?? Number.MAX_SAFE_INTEGER) - (b.reachedAt ?? Number.MAX_SAFE_INTEGER) ||
        (a.address < b.address ? -1 : a.address > b.address ? 1 : 0),
    )
    .map((s, i) => ({
      rank: i + 1,
      address: s.address,
      points: s.points,
      wins: s.wins,
      duels: s.duels,
    }));
}
