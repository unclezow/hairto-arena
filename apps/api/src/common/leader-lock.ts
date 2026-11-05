import { randomUUID } from 'node:crypto';
import type { RedisService } from '../redis/redis.service.js';

const RENEW_IF_OWNER = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE_IF_OWNER = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

/**
 * A Redis lock one instance holds while it does a job that must run in one place at a time. The holder renews it
 * on every call; if it stops, the lock expires and a standby takes over.
 */
export class LeaderLock {
  readonly id = randomUUID();

  constructor(
    private readonly redis: RedisService,
    private readonly key: string,
    private readonly ttlMs: number,
  ) {}

  async hold(): Promise<boolean> {
    const renewed = await this.redis.client.eval(RENEW_IF_OWNER, 1, this.key, this.id, this.ttlMs);
    if (renewed === 1) return true;
    return (await this.redis.client.set(this.key, this.id, 'PX', this.ttlMs, 'NX')) === 'OK';
  }

  async release(): Promise<void> {
    await this.redis.client.eval(RELEASE_IF_OWNER, 1, this.key, this.id).catch(() => undefined);
  }
}
