import { Injectable } from '@nestjs/common';
import { conflict, notFound } from '../common/errors.js';
import { BotAuditService } from '../bot/bot-audit.service.js';
import type { BotConfigSnapshot } from '../bot/duel-recorder.js';
import { isEncryptedSeed } from '../bot/seed-crypto.js';
import { normalizeSeed, seedToBase64 } from '../bot/seed.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { DuelViewService, isTerminal, type DuelRow } from './duel-view.service.js';

const CACHE_TTL_SEC = 24 * 60 * 60;
const cacheKey = (id: bigint) => `replay:${id}`;

/** Ticks and revealed positions of a finished duel, plus what is needed to audit the bot. */
@Injectable()
export class ReplayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly views: DuelViewService,
    private readonly audit: BotAuditService,
  ) {}

  async get(id: bigint) {
    const duel = await this.prisma.duel.findUnique({
      where: { id },
      include: { bot: true, positions: true, botSeed: true },
    });
    if (!duel) throw notFound('Duel not found');
    // No early disclosure: neither positions nor the seed leave before the duel is over.
    if (!isTerminal(duel.status)) throw conflict('DUEL_NOT_FINISHED', 'The duel is still running');

    const cached = await this.redis.client.get(cacheKey(id)).catch(() => null);
    if (cached) return JSON.parse(cached) as unknown;

    const replay = await this.build(
      duel as DuelRow & {
        botSeed: { seedHash: string; seed: string | null; revealedAt: Date | null } | null;
      },
    );
    // A replay is only final once the seed is revealed and audited; until then do not freeze it in the cache.
    if (replay.bot.seed !== null) {
      await this.redis.client
        .set(cacheKey(id), JSON.stringify(replay), 'EX', CACHE_TTL_SEC)
        .catch(() => undefined);
    }
    return replay;
  }

  private async build(
    duel: DuelRow & {
      botSeed: { seedHash: string; seed: string | null; revealedAt: Date | null } | null;
    },
  ) {
    const snapshot = duel.botConfig as unknown as BotConfigSnapshot;
    const start = duel.startAt ?? duel.createdAt;
    const roundSec = snapshot.config?.roundSec ?? 30;
    const ticks = await this.prisma.tick.findMany({
      where: {
        assetId: duel.assetId,
        publishTime: { gte: start, lte: new Date(start.getTime() + (roundSec + 5) * 1000) },
      },
      orderBy: { tickIndex: 'asc' },
    });

    const seed =
      duel.botSeed?.revealedAt && duel.botSeed.seed && !isEncryptedSeed(duel.botSeed.seed)
        ? seedToBase64(normalizeSeed(duel.botSeed.seed))
        : null;
    const verification = seed ? await this.audit.verify(duel.id) : null;

    return {
      duel: await this.views.view(duel),
      ticks: ticks.map((t) => ({
        tickIndex: t.tickIndex,
        price: t.price.toFixed(),
        publishMs: t.publishTime.getTime(),
      })),
      bot: {
        level: duel.bot.level,
        strategy: snapshot.strategy,
        config: snapshot.config,
        seedHash: duel.botSeed?.seedHash ?? null,
        seed,
        // 'match' when replaying the seed over the stored ticks gives the positions the bot took.
        verification: verification
          ? { status: verification.status, reason: verification.reason ?? null }
          : null,
      },
    };
  }
}
