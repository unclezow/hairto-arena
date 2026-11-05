export type SeasonPhase = 'pick-window' | 'active' | 'closed' | 'dispute-window' | 'claimable';

export interface SeasonTimes {
  startAt: Date;
  endAt: Date;
  /** Indexer phase: `active`, `closed` or `results_posted`. */
  phase: string;
  resultsPostedAt: Date | null;
}

export interface SeasonWindows {
  pickWindowMs: number;
  disputeWindowMs: number;
}

/** Where a season is in its life. Time decides what the chain has not announced yet. */
export function seasonPhase(season: SeasonTimes, now: Date, w: SeasonWindows): SeasonPhase {
  if (season.resultsPostedAt) {
    const disputeEnds = season.resultsPostedAt.getTime() + w.disputeWindowMs;
    return now.getTime() < disputeEnds ? 'dispute-window' : 'claimable';
  }
  if (season.phase === 'closed' || now.getTime() >= season.endAt.getTime()) return 'closed';
  if (now.getTime() < season.startAt.getTime() + w.pickWindowMs) return 'pick-window';
  return 'active';
}

export function seasonTimers(season: SeasonTimes, w: SeasonWindows) {
  return {
    pickWindowEndsAt: new Date(season.startAt.getTime() + w.pickWindowMs),
    disputeEndsAt: season.resultsPostedAt
      ? new Date(season.resultsPostedAt.getTime() + w.disputeWindowMs)
      : null,
  };
}
