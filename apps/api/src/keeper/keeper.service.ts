import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env.js';
import { NearService } from '../near/near.service.js';
import { RedisService } from '../redis/redis.service.js';
import { HARVEST_NOW_CHANNEL, HarvestJob } from './harvest-job.service.js';
import { SeasonKeeper } from './season-keeper.service.js';

/**
 * Runs the keeper's two jobs on their own timers, plus a harvest on demand from the admin page. What they may do
 * is decided by `KeeperModeService`; without a keeper key they do not start.
 */
@Injectable()
export class KeeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KeeperService.name);
  private timers: NodeJS.Timeout[] = [];
  private subscriber?: Redis;

  constructor(
    private readonly seasons: SeasonKeeper,
    private readonly harvest: HarvestJob,
    private readonly near: NearService,
    private readonly redis: RedisService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onModuleInit() {
    if (!this.near.hasSigner('keeper')) {
      if (this.config.get('KEEPER_ENABLED', { infer: true })) {
        if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
          throw new Error('KEEPER_KEY is required in production while KEEPER_ENABLED is true');
        }
        this.logger.warn('KEEPER_KEY is not set: the keeper does not run');
      }
      return;
    }
    this.every(
      this.config.get('KEEPER_SEASON_INTERVAL_MS', { infer: true }),
      () => this.seasons.runOnce(),
      'season',
    );
    this.every(
      this.config.get('KEEPER_HARVEST_INTERVAL_MS', { infer: true }),
      () => this.harvest.runOnce(),
      'harvest',
    );

    this.subscriber = this.redis.createSubscriber();
    this.subscriber.on(
      'message',
      () =>
        void this.harvest
          .runOnce()
          .catch((e: Error) => this.logger.error(`Keeper harvest on demand: ${e.message}`)),
    );
    await this.subscriber.subscribe(HARVEST_NOW_CHANNEL).catch((err: Error) => {
      this.logger.warn(`Redis unavailable, harvest on demand disabled: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    for (const t of this.timers) clearInterval(t);
    await this.subscriber?.quit().catch(() => undefined);
  }

  private every(ms: number, job: () => Promise<unknown>, name: string) {
    const timer = setInterval(
      () => void job().catch((e: Error) => this.logger.error(`Keeper ${name}: ${e.message}`)),
      ms,
    );
    timer.unref();
    this.timers.push(timer);
  }
}
