export interface BalanceEvent {
  /** Unix ms. */
  at: number;
  /** Positive for a deposit, negative for a withdrawal. */
  delta: bigint;
}

/** Balance after every event at or before `ts`. */
export function balanceAt(events: readonly BalanceEvent[], ts: number): bigint {
  return events.filter((e) => e.at <= ts).reduce((sum, e) => sum + e.delta, 0n);
}

/**
 * Time weighted average balance over `[start, end]`: the integral of the balance over time divided by the
 * length of the window, floored. Events before `start` set the opening balance; events after `end` are ignored.
 * Events at the same instant apply in the order given.
 */
export function twab(events: readonly BalanceEvent[], start: number, end: number): bigint {
  if (end <= start) return 0n;
  const ordered = events
    .map((e, index) => ({ ...e, index }))
    .sort((a, b) => a.at - b.at || a.index - b.index);

  let balance = 0n;
  let cursor = start;
  let area = 0n;
  for (const e of ordered) {
    if (e.at >= end) break;
    if (e.at <= start) {
      balance += e.delta;
      continue;
    }
    area += balance * BigInt(e.at - cursor);
    cursor = e.at;
    balance += e.delta;
  }
  area += balance * BigInt(end - cursor);
  return area / BigInt(end - start);
}
