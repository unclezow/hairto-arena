import { LanePool, LaneTimeoutError } from './lane-pool.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('LanePool', () => {
  it('gives concurrent sends different lanes', async () => {
    const pool = new LanePool('bot:1', 8);
    const lanes: number[] = [];
    const gates = [deferred(), deferred()];
    const runs = gates.map((gate) =>
      pool.run(async (lane) => {
        lanes.push(lane);
        await gate.promise;
        return lane;
      }),
    );
    await Promise.resolve();
    expect(new Set(lanes).size).toBe(2);
    expect(pool.stats()).toMatchObject({ size: 8, inUse: 2, waiting: 0 });
    gates.forEach((g) => g.resolve());
    await Promise.all(runs);
    expect(pool.stats()).toMatchObject({ inUse: 0, sent: 2, failed: 0 });
  });

  it('never hands one lane to two sends, even under load', async () => {
    const pool = new LanePool('pusher', 3);
    const active = new Set<number>();
    let clash = false;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        pool.run(async (lane) => {
          if (active.has(lane)) clash = true;
          active.add(lane);
          peak = Math.max(peak, active.size);
          await new Promise((r) => setTimeout(r, i % 4));
          active.delete(lane);
        }),
      ),
    );
    expect(clash).toBe(false);
    expect(peak).toBe(3);
    expect(pool.stats()).toMatchObject({ inUse: 0, waiting: 0, sent: 40 });
  });

  it('releases the lane when the send fails', async () => {
    const pool = new LanePool('keeper', 1);
    await expect(
      pool.run(async () => {
        throw new Error('InvalidNonce');
      }),
    ).rejects.toThrow('InvalidNonce');
    expect(pool.stats()).toMatchObject({ inUse: 0, failed: 1 });
    await expect(pool.run(async (lane) => lane)).resolves.toBe(0);
  });

  it('queues callers in arrival order while every lane is busy', async () => {
    const pool = new LanePool('bot:2', 1);
    const gate = deferred();
    const order: string[] = [];
    const first = pool.run(async () => {
      await gate.promise;
      order.push('first');
    });
    const second = pool.run(async () => void order.push('second'));
    const third = pool.run(async () => void order.push('third'));
    await Promise.resolve();
    expect(pool.stats()).toMatchObject({ inUse: 1, waiting: 2 });
    gate.resolve();
    await Promise.all([first, second, third]);
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('gives up waiting after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const pool = new LanePool('bot:3', 1, 1_000);
      const held = await pool.acquire();
      const waiting = pool.acquire();
      vi.advanceTimersByTime(1_000);
      await expect(waiting).rejects.toBeInstanceOf(LaneTimeoutError);
      expect(pool.stats().waiting).toBe(0);
      pool.release(held);
      expect(pool.stats().inUse).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a release of a lane that is not held', () => {
    const pool = new LanePool('bot:4', 2);
    pool.release(1);
    expect(pool.stats()).toMatchObject({ inUse: 0 });
    expect(() => new LanePool('bad', 0)).toThrow('at least 1');
  });
});
