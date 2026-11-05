import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { WS_EVENTS, type TickEvent } from '@hairto-arena/shared';
import type { Redis } from 'ioredis';
import { ORACLE_KEYS, type OracleState } from '../price/oracle-keys.js';
import { CHANNELS } from '../realtime/channels.js';
import { RedisService } from '../redis/redis.service.js';
import type { PriceTick } from './strategies/bot-strategy.js';

/** What the runner needs from the price service. Production uses Redis; tests use a fake. */
export interface TickSource {
  subscribe(assetId: number, listener: (tick: PriceTick) => void): () => void;
  /** The most recent `count` ticks, oldest first. */
  history(assetId: number, count: number): Promise<PriceTick[]>;
  /** False while the oracle is stale or in outage. Unknown state counts as healthy. */
  oracleOk(assetId: number): Promise<boolean>;
}

export const TICK_SOURCE = Symbol('TICK_SOURCE');

@Injectable()
export class RedisTickFeed implements TickSource, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisTickFeed.name);
  private readonly listeners = new Map<number, Set<(tick: PriceTick) => void>>();
  private subscriber?: Redis;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit() {
    this.subscriber = this.redis.createSubscriber();
    this.subscriber.on('pmessage', (_pattern, channel, message) => this.dispatch(channel, message));
    try {
      await this.subscriber.psubscribe(CHANNELS.pricePattern);
    } catch (err) {
      this.logger.warn(`Redis unavailable, tick feed disabled: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.subscriber?.quit().catch(() => undefined);
  }

  subscribe(assetId: number, listener: (tick: PriceTick) => void) {
    const set = this.listeners.get(assetId) ?? new Set();
    set.add(listener);
    this.listeners.set(assetId, set);
    return () => {
      set.delete(listener);
    };
  }

  async history(assetId: number, count: number): Promise<PriceTick[]> {
    const entries = await this.redis.client.xrevrange(
      ORACLE_KEYS.tickStream(assetId),
      '+',
      '-',
      'COUNT',
      count,
    );
    return entries
      .map(([, fields]) => {
        const f = Object.fromEntries(chunk(fields));
        return {
          tickIndex: Number(f.tickIndex),
          price: Number(f.price),
          publishMs: Number(f.publishMs),
        };
      })
      .reverse();
  }

  async oracleOk(assetId: number): Promise<boolean> {
    const raw = await this.redis.client.get(ORACLE_KEYS.state(assetId)).catch(() => null);
    if (!raw) return true;
    return (JSON.parse(raw) as OracleState).status === 'ok';
  }

  private dispatch(channel: string, message: string) {
    const assetId = Number(channel.split(':')[1]);
    const set = this.listeners.get(assetId);
    if (!set?.size) return;
    try {
      const { event, data } = JSON.parse(message) as { event: string; data: TickEvent };
      if (event !== WS_EVENTS.tick) return;
      const tick: PriceTick = {
        tickIndex: data.tickIndex,
        price: Number(data.price),
        publishMs: data.publishMs,
      };
      for (const listener of set) listener(tick);
    } catch {
      this.logger.warn(`Dropped malformed message on ${channel}`);
    }
  }
}

function chunk(fields: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < fields.length; i += 2) out.push([fields[i]!, fields[i + 1]!]);
  return out;
}
