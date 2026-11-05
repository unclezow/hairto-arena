import type { OracleHealth } from '@hairto-arena/shared';

export interface OracleLimits {
  /** Older than this the tick is invalid (default 5 s, the arena's `max_staleness_ms`). */
  maxStalenessMs: number;
  /** Older than this the oracle is in outage and running duels are voided (default 10 s). */
  voidAfterOutageMs: number;
}

/**
 * Freshness verdict from the age of the latest tick, in ms. `chainNowMs` is the latest block timestamp, so the
 * worker's clock never decides.
 */
export function oracleVerdict(
  lastPublishMs: number,
  chainNowMs: number,
  limits: OracleLimits,
): OracleHealth {
  const age = chainNowMs - lastPublishMs;
  if (age > limits.voidAfterOutageMs) return 'outage';
  if (age > limits.maxStalenessMs) return 'stale';
  return 'ok';
}
