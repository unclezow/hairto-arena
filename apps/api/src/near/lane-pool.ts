/** Point-in-time view of a lane pool, reported by `/health`. */
export interface LaneStats {
  size: number;
  inUse: number;
  waiting: number;
  sent: number;
  failed: number;
}

export class LaneTimeoutError extends Error {
  constructor(name: string, waitedMs: number) {
    super(`no free ${name} lane after ${waitedMs} ms`);
    this.name = 'LaneTimeoutError';
  }
}

interface Waiter {
  resolve: (lane: number) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
}

/**
 * Nonce lanes of one gas key. Each lane has its own nonce on chain, so transactions on different lanes never race
 * for a nonce. A send takes a free lane and gives it back once the transaction finished or failed; with every lane
 * busy, callers queue in arrival order.
 *
 * near-kit caches nonces per process, so a gas key must be used by exactly one process (the worker).
 */
export class LanePool {
  private readonly free: number[];
  private readonly busy = new Set<number>();
  private readonly waiters: Waiter[] = [];
  private sent = 0;
  private failed = 0;

  constructor(
    readonly name: string,
    readonly size: number,
    private readonly acquireTimeoutMs = 30_000,
  ) {
    if (!Number.isInteger(size) || size < 1)
      throw new Error(`${name}: lane count must be at least 1`);
    this.free = Array.from({ length: size }, (_, i) => i);
  }

  /** Runs `send` on a free lane and releases the lane afterwards, whatever the outcome. */
  async run<T>(send: (lane: number) => Promise<T>): Promise<T> {
    const lane = await this.acquire();
    try {
      const result = await send(lane);
      this.sent++;
      return result;
    } catch (error) {
      this.failed++;
      throw error;
    } finally {
      this.release(lane);
    }
  }

  acquire(): Promise<number> {
    const lane = this.free.shift();
    if (lane !== undefined) {
      this.busy.add(lane);
      return Promise.resolve(lane);
    }
    return new Promise<number>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      if (this.acquireTimeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(new LaneTimeoutError(this.name, this.acquireTimeoutMs));
        }, this.acquireTimeoutMs);
        waiter.timer.unref?.();
      }
      this.waiters.push(waiter);
    });
  }

  release(lane: number): void {
    if (!this.busy.has(lane)) return;
    const next = this.waiters.shift();
    if (next) {
      // The lane goes straight to the next caller, so it never shows as free in between.
      if (next.timer) clearTimeout(next.timer);
      next.resolve(lane);
      return;
    }
    this.busy.delete(lane);
    this.free.push(lane);
  }

  stats(): LaneStats {
    return {
      size: this.size,
      inUse: this.busy.size,
      waiting: this.waiters.length,
      sent: this.sent,
      failed: this.failed,
    };
  }
}
