import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BotLevel } from '@hairto-arena/shared';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { ACCOUNT_ID_PATTERN } from '../common/account-id.js';
import type { Env } from '../config/env.js';
import { ArenaClient } from '../near/arena.client.js';
import type { SeedTicketJson } from '../near/arena.types.js';
import { checkBotSetup } from '../near/boot-checks.js';
import { NearService } from '../near/near.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CHANNELS } from '../realtime/channels.js';
import { RedisService } from '../redis/redis.service.js';
import { BotChainError, BotDuelService, NoActiveSeason } from './bot-duel.service.js';
import { SeedRevealer } from './seed-revealer.service.js';
import { STRATEGIES } from './strategies/index.js';

/** The request the API sends on `bot:requests` after its own eligibility checks. */
export const botRequestSchema = z.object({
  requestId: z.string().min(1).max(100),
  type: z.literal('issue-ticket'),
  fighter: z.string().regex(ACCOUNT_ID_PATTERN),
  assetId: z.number().int().positive(),
  botLevel: z.number().int().min(1).max(4),
});

export type BotRequest = z.infer<typeof botRequestSchema>;

export type BotReply =
  | {
      requestId: string;
      ok: true;
      ticket: SeedTicketJson;
      signature: string;
      deadlineMs: number;
    }
  | { requestId: string; ok: false; code: string; message: string };

/**
 * The bot worker: signs seed tickets for the API over Redis, watches for the duels they start, resumes duels and
 * pending tickets after a restart, and reveals seeds.
 */
@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private subscriber?: Redis;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly near: NearService,
    private readonly arena: ArenaClient,
    private readonly config: ConfigService<Env, true>,
    private readonly duels: BotDuelService,
    private readonly revealer: SeedRevealer,
  ) {}

  /**
   * The arena only accepts bot moves from the account it has for the duel's level, and tickets signed with its
   * bot service key. A mismatch would fail every duel, so it is checked at boot and the bot stays off for it.
   */
  private async configureTickets(): Promise<BotLevel[]> {
    const report = await checkBotSetup(this.near, this.arena);
    for (const problem of report.problems) this.logger.error(`Bot setup: ${problem}`);
    for (const warning of report.warnings) this.logger.warn(`Bot setup: ${warning}`);
    const levels = report.levels.filter((level) => STRATEGIES[level]);
    const ticketKey = this.near.ticketKey();
    if (!report.ticketKeyOk || !ticketKey || levels.length === 0) {
      this.duels.configure(null);
      this.logger.error('Bot module disabled: no seed ticket will be signed');
      return [];
    }
    this.duels.configure({ arenaId: this.arena.contractId, ticketKey, levels });
    return levels;
  }

  async onModuleInit() {
    if (!this.config.get('BOT_ENABLED', { infer: true })) return;

    try {
      const levels = await this.configureTickets();
      await this.ensureBotRows(levels);
      const resumed = await this.duels.resumeActive();
      const watching = await this.duels.resumePending();
      this.logger.log(
        `Bot service ready for levels [${levels.join(', ')}], resumed ${resumed} duel(s), ` +
          `watching ${watching} ticket(s)`,
      );
    } catch (err) {
      this.logger.warn(`Bot service startup incomplete: ${(err as Error).message}`);
    }

    this.subscriber = this.redis.createSubscriber();
    this.subscriber.on('message', (_channel, message) => void this.handleRequest(message));
    try {
      await this.subscriber.subscribe(CHANNELS.botRequests);
    } catch (err) {
      this.logger.warn(`Redis unavailable, bot requests disabled: ${(err as Error).message}`);
    }

    const timer = setInterval(
      () => void this.revealer.run().catch((e: Error) => this.logger.warn(`reveal: ${e.message}`)),
      this.config.get('BOT_REVEAL_INTERVAL_MS', { infer: true }),
    );
    timer.unref();
    this.timers.push(timer);
  }

  async onModuleDestroy() {
    for (const t of this.timers) clearInterval(t);
    this.duels.stopAll();
    await this.subscriber?.quit().catch(() => undefined);
  }

  /** One Bot row per served level, so duels can reference their bot. Existing rows are left as the admin set them. */
  private async ensureBotRows(levels: BotLevel[]) {
    for (const level of levels) {
      const address = this.near.botAccount(level);
      const strategy = STRATEGIES[level]!;
      await this.prisma.bot.upsert({
        where: { address },
        create: {
          address,
          name: strategy.name,
          level,
          strategy: strategy.name.toLowerCase(),
          config: {},
        },
        update: {},
      });
    }
  }

  async handleRequest(message: string): Promise<BotReply | null> {
    let requestId = 'unknown';
    try {
      const request = botRequestSchema.parse(JSON.parse(message));
      requestId = request.requestId;
      const issued = await this.duels.issueTicket({
        fighter: request.fighter,
        assetId: request.assetId,
        botLevel: request.botLevel as BotLevel,
      });
      return await this.reply({ requestId, ok: true, ...issued });
    } catch (err) {
      return this.reply({ requestId, ok: false, ...this.describe(err) });
    }
  }

  private describe(err: unknown): { code: string; message: string } {
    if (err instanceof BotChainError) return { code: err.code, message: err.message };
    if (err instanceof NoActiveSeason) return { code: 'NO_ACTIVE_SEASON', message: err.message };
    if (err instanceof z.ZodError || err instanceof SyntaxError)
      return { code: 'BAD_REQUEST', message: 'Malformed bot request' };
    this.logger.error(`Bot request failed: ${(err as Error).message}`);
    return { code: 'BOT_UNAVAILABLE', message: 'The bot could not sign a ticket' };
  }

  private async reply(reply: BotReply): Promise<BotReply> {
    await this.redis.publish(CHANNELS.botReply(reply.requestId), reply).catch((e: Error) => {
      this.logger.warn(`Could not send reply ${reply.requestId}: ${e.message}`);
    });
    return reply;
  }
}
