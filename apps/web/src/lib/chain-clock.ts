/**
 * Offset between the chain clock and this browser, in ms (chain minus local), from the latest block time. The arena
 * times duels with block timestamps, so countdowns shift chain times into local time with this offset.
 */
export function clockOffsetMs(latestBlockTimeIso: string, localNowMs: number): number {
  const chainMs = Date.parse(latestBlockTimeIso);
  return Number.isFinite(chainMs) ? chainMs - localNowMs : 0;
}

/** A chain time in seconds, moved to the local clock. */
export const toLocalSec = (chainSec: number, offsetMs: number) => chainSec - offsetMs / 1000;
