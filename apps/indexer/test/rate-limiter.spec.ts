import { RateLimiter, type Clock } from '../src/neardata/rate-limiter.js';

/** A clock that only moves when the limiter sleeps, plus 400 ms per request. */
function fakeClock() {
  let now = 0;
  const clock: Clock = {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  };
  return { clock, tick: (ms: number) => (now += ms), at: () => now };
}

describe('RateLimiter', () => {
  it('never lets more than the budget start in any 60-second window while catching up', async () => {
    const t = fakeClock();
    const limiter = new RateLimiter(150, t.clock);
    const starts: number[] = [];
    // 5 000 blocks behind: the ingest loop asks as fast as it can.
    for (let i = 0; i < 600; i++) {
      await limiter.take();
      starts.push(t.at());
      t.tick(50);
    }
    for (const start of starts) {
      expect(starts.filter((s) => s >= start && s < start + 60_000).length).toBeLessThanOrEqual(
        150,
      );
    }
    expect(t.at()).toBeGreaterThanOrEqual(3 * 60_000);
  });

  it('does not wait while under the budget', async () => {
    const t = fakeClock();
    const limiter = new RateLimiter(3, t.clock);
    await limiter.take();
    await limiter.take();
    expect(t.at()).toBe(0);
    expect(limiter.used).toBe(2);
    expect(() => new RateLimiter(0)).toThrow();
  });
});
