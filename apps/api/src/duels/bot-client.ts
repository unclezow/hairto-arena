import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { BotReply } from '../bot/bot.service.js';
import { AppException, upstreamUnavailable } from '../common/errors.js';
import type { Env } from '../config/env.js';
import { RedisService } from '../redis/redis.service.js';
import { CHANNELS } from '../realtime/channels.js';
import type { SeedTicketJson } from '../near/arena.types.js';

/** What the Fighter sends to `arena.start_duel`, plus when the ticket stops being valid. */
export interface IssuedTicket {
  ticket: SeedTicketJson;
  /** Base64 ed25519 signature. */
  signature: string;
  deadlineMs: number;
}

/** What each bot worker error code means for the caller. */
const FAILURES: Record<string, { status: number; code: string }> = {
  BAD_REQUEST: { status: 400, code: 'VALIDATION_FAILED' },
  ORACLE_UNAVAILABLE: { status: 503, code: 'ORACLE_UNAVAILABLE' },
  CHAIN_REVERTED: { status: 409, code: 'CHAIN_REVERTED' },
  CHAIN_UNAVAILABLE: { status: 503, code: 'UPSTREAM_UNAVAILABLE' },
  BOT_UNAVAILABLE: { status: 503, code: 'BOT_UNAVAILABLE' },
  NO_ACTIVE_SEASON: { status: 409, code: 'NO_ACTIVE_SEASON' },
};

/**
 * Asks the bot worker for a seed ticket. The HTTP process holds no key, so the request goes over Redis
 * (`bot:requests`) and the answer comes back on `bot:replies:{requestId}`.
 */
@Injectable()
export class BotClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotClient.name);
  private readonly pending = new Map<string, (reply: BotReply) => void>();
  private subscriber?: Redis;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onModuleInit() {
    this.subscriber = this.redis.createSubscriber();
    this.subscriber.on('pmessage', (_pattern, channel, message) => {
      const requestId = channel.slice('bot:replies:'.length);
      const resolve = this.pending.get(requestId);
      if (!resolve) return;
      try {
        resolve(JSON.parse(message) as BotReply);
      } catch {
        this.logger.warn(`Dropped malformed bot reply ${requestId}`);
      }
    });
    try {
      await this.subscriber.psubscribe('bot:replies:*');
    } catch (err) {
      this.logger.warn(`Redis unavailable, bot replies disabled: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.subscriber?.quit().catch(() => undefined);
  }

  async requestTicket(input: {
    fighter: string;
    assetId: number;
    botLevel: number;
  }): Promise<IssuedTicket> {
    const requestId = randomUUID();
    const timeoutMs = this.config.get('DUEL_BOT_TIMEOUT_MS', { infer: true });

    const reply = new Promise<BotReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new AppException(504, 'BOT_TIMEOUT', 'The bot did not answer in time, try again'));
      }, timeoutMs);
      this.pending.set(requestId, (r) => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve(r);
      });
    });
    reply.catch(() => undefined);

    let listeners: number;
    try {
      listeners = await this.redis.publish(CHANNELS.botRequests, {
        requestId,
        type: 'issue-ticket',
        fighter: input.fighter,
        assetId: input.assetId,
        botLevel: input.botLevel,
      });
    } catch {
      this.pending.delete(requestId);
      throw upstreamUnavailable('The bot service is unreachable');
    }
    if (listeners === 0) {
      this.pending.delete(requestId);
      throw new AppException(503, 'BOT_UNAVAILABLE', 'No bot is running right now');
    }

    const answer = await reply;
    if (answer.ok)
      return { ticket: answer.ticket, signature: answer.signature, deadlineMs: answer.deadlineMs };
    const failure = FAILURES[answer.code] ?? { status: 503, code: 'BOT_UNAVAILABLE' };
    throw new AppException(failure.status, failure.code, answer.message);
  }
}
