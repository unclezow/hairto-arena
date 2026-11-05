import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../redis/redis.service.js';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

/** Sliding window log in a Redis sorted set: one member per request, scored by its timestamp. */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  async hit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSec * 1000;
    const member = `${now}-${randomUUID()}`;
    const redisKey = `rl:${key}`;

    const results = await this.redis.client
      .multi()
      .zremrangebyscore(redisKey, 0, now - windowMs)
      .zadd(redisKey, now, member)
      .zcard(redisKey)
      .zrange(redisKey, '0', '0', 'WITHSCORES')
      .pexpire(redisKey, windowMs)
      .exec();
    if (!results) throw new Error('Redis transaction aborted');

    const count = Number(results[2]?.[1]);
    if (count <= limit) return { allowed: true, retryAfterSec: 0 };

    // Over the limit: the rejected hit must not extend the window.
    await this.redis.client.zrem(redisKey, member);
    const oldest = Number((results[3]?.[1] as string[] | undefined)?.[1] ?? now);
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }
}
