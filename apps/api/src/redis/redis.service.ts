import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../config/env.js';

/**
 * Pub/sub between the API process and the worker process.
 * Channels: `duel:<id>` (HP, results), `price:<assetId>` (ticks), `bot:requests` (duel start requests).
 */
@Injectable()
export class RedisService implements OnApplicationShutdown {
  /** Commands and publishing. */
  readonly client: Redis;
  private readonly subscribers: Redis[] = [];

  constructor(config: ConfigService<Env, true>) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      lazyConnect: true,
      // Without these, ioredis backs off further on every failed command and requests hang for many seconds
      // while Redis is down. Callers decide what to do (fail open or closed) after a bounded wait.
      maxRetriesPerRequest: 1,
      commandTimeout: 1500,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    // Connection errors surface as rejected commands; the default handler would print every retry.
    this.client.on('error', () => undefined);
  }

  /** A dedicated connection is required once a client enters subscriber mode. */
  createSubscriber(): Redis {
    const sub = this.client.duplicate();
    this.subscribers.push(sub);
    return sub;
  }

  publish(channel: string, payload: unknown): Promise<number> {
    return this.client.publish(channel, JSON.stringify(payload));
  }

  /**
   * Last step of shutdown. Closing in `onModuleDestroy` would cut the connections while the Socket.IO server and
   * its Redis adapter are still open, and the adapter's own cleanup would then fail on a closed connection.
   */
  async onApplicationShutdown() {
    await Promise.all(
      [this.client, ...this.subscribers].map((c) => c.quit().catch(() => undefined)),
    );
  }
}
