import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';
import type { BrainState } from './bot-brain.js';
import type { RunnerStateStore } from './bot-duel-runner.js';

const key = (duelId: bigint) => `bot:duel:${duelId}`;

/** Runner progress in Redis. Losing it is survivable: the runner re-derives an open position from the chain. */
@Injectable()
export class RedisRunnerState implements RunnerStateStore {
  constructor(private readonly redis: RedisService) {}

  async load(duelId: bigint): Promise<BrainState | null> {
    const raw = await this.redis.client.get(key(duelId));
    return raw ? (JSON.parse(raw) as BrainState) : null;
  }

  async save(duelId: bigint, state: BrainState) {
    await this.redis.client.set(key(duelId), JSON.stringify(state), 'EX', 3600);
  }
}
