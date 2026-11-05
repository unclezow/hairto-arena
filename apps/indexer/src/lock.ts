import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

const RENEW = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

/** Only one indexer may write schema `chain`; a standby takes over when the holder's lease expires. */
export class SingleInstanceLock {
  readonly id = randomUUID();

  constructor(
    private readonly redis: Redis,
    private readonly key = 'indexer:lock',
    private readonly ttlMs = 30_000,
  ) {}

  /** Takes the lock, or renews it when this instance already holds it. */
  async hold(): Promise<boolean> {
    if ((await this.redis.eval(RENEW, 1, this.key, this.id, this.ttlMs)) === 1) return true;
    return (await this.redis.set(this.key, this.id, 'PX', this.ttlMs, 'NX')) === 'OK';
  }

  async release(): Promise<void> {
    await this.redis.eval(RELEASE, 1, this.key, this.id);
  }
}
