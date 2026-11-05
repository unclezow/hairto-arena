import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { RedisService } from '../redis/redis.service.js';

/** Flags an admin can flip without a deploy. The environment provides the default. */
export type FlagName = 'DUELS_ENABLED' | 'KEEPER_ENABLED' | 'KEEPER_DRY_RUN';

const HASH = 'flags';

@Injectable()
export class RuntimeFlagsService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async get(name: FlagName): Promise<boolean> {
    const override = await this.redis.client.hget(HASH, name).catch(() => null);
    if (override !== null) return override === 'true';
    return this.defaultOf(name);
  }

  /** The stored override, or null when the environment default applies. */
  async override(name: FlagName): Promise<boolean | null> {
    const stored = await this.redis.client.hget(HASH, name);
    return stored === null ? null : stored === 'true';
  }

  async set(name: FlagName, value: boolean): Promise<void> {
    await this.redis.client.hset(HASH, name, String(value));
  }

  /** Removes the override, so the environment default applies again. */
  async reset(name: FlagName): Promise<void> {
    await this.redis.client.hdel(HASH, name);
  }

  private defaultOf(name: FlagName): boolean {
    return this.config.get(name, { infer: true });
  }
}

@Global()
@Module({ providers: [RuntimeFlagsService], exports: [RuntimeFlagsService] })
export class RuntimeFlagsModule {}
