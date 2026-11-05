export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * At most `perMinute` requests in any 60-second window, shared by every request the indexer makes (Neardata
 * blocks, final-head checks, Transactions API pages). A sliding window of start times, so a burst never exceeds
 * the budget either: the free Neardata tier allows 180 per minute per IP.
 */
export class RateLimiter {
  private readonly starts: number[] = [];

  constructor(
    readonly perMinute: number,
    private readonly clock: Clock = realClock,
  ) {
    if (!Number.isInteger(perMinute) || perMinute < 1)
      throw new Error('perMinute must be at least 1');
  }

  /** Waits until a request may start, then records it. */
  async take(): Promise<void> {
    for (;;) {
      const now = this.clock.now();
      while (this.starts.length > 0 && now - this.starts[0]! >= 60_000) this.starts.shift();
      if (this.starts.length < this.perMinute) {
        this.starts.push(now);
        return;
      }
      await this.clock.sleep(60_000 - (now - this.starts[0]!));
    }
  }

  /** Requests started in the last minute. */
  get used(): number {
    const now = this.clock.now();
    return this.starts.filter((t) => now - t < 60_000).length;
  }
}
