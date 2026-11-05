import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { WS_EVENTS, type TickEvent } from '@hairto-arena/shared';
import { toDecimalString } from '../common/decimal.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CHANNELS } from '../realtime/channels.js';
import { RedisService } from '../redis/redis.service.js';
import { ORACLE_KEYS } from './oracle-keys.js';
import type { RecordedTick } from './oracle-writer.js';

/** About two minutes of ticks per asset at one tick per second. */
const STREAM_MAX_LEN = 150;

/**
 * Where recorded ticks go: the Redis stream the bot and gateway read, the realtime channel, and Postgres
 * (buffered, because replay does not need to be synchronous).
 */
@Injectable()
export class TickSink implements OnModuleDestroy {
  private readonly logger = new Logger(TickSink.name);
  private buffer: Prisma.TickCreateManyInput[] = [];

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async publish(ticks: RecordedTick[]) {
    for (const tick of ticks) {
      const price = toDecimalString(tick.price, tick.expo);
      this.buffer.push({
        assetId: tick.assetId,
        tickIndex: tick.tickIndex,
        price: new Prisma.Decimal(price),
        expo: tick.expo,
        publishTime: new Date(tick.publishMs),
      });
      const event: TickEvent = {
        assetId: tick.assetId,
        tickIndex: tick.tickIndex,
        price,
        publishMs: tick.publishMs,
      };
      await this.redis.client
        .multi()
        .xadd(
          ORACLE_KEYS.tickStream(tick.assetId),
          'MAXLEN',
          '~',
          STREAM_MAX_LEN,
          '*',
          'tickIndex',
          String(tick.tickIndex),
          'price',
          price,
          'expo',
          String(tick.expo),
          'publishMs',
          String(tick.publishMs),
        )
        .publish(
          CHANNELS.price(tick.assetId),
          JSON.stringify({ event: WS_EVENTS.tick, data: event }),
        )
        .exec()
        .catch((err: Error) => this.logger.warn(`Could not publish tick: ${err.message}`));
    }
  }

  /** Writes buffered ticks to Postgres. On failure the ticks stay buffered for the next flush. */
  async flush() {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.prisma.tick.createMany({ data: batch, skipDuplicates: true });
    } catch (err) {
      this.buffer = [...batch, ...this.buffer];
      this.logger.warn(`Tick flush failed, will retry: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.flush();
  }
}
