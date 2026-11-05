import { Injectable } from '@nestjs/common';
import type { BotLevel } from '@hairto-arena/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { botConfigSchema, resolveBotConfig, type BotConfig } from './bot-config.js';
import { BotSeedStore } from './seed-store.js';
import { STRATEGIES } from './strategies/index.js';

export interface RecordDuelInput {
  duelId: bigint;
  level: BotLevel;
  fighter: string;
  botAccount: string;
  assetId: number;
  /** The arena duel's `start_ms`. */
  startMs: number;
  /** Base58 hash of the Fighter's `start_duel`, when known. The indexer fills it otherwise. */
  txHash?: string;
  /** Base64. */
  seedHash: string;
}

/** What is stored in `duels.bot_config`: the effective configuration at the time the duel was created. */
export interface BotConfigSnapshot {
  level: BotLevel;
  strategy: string;
  config: BotConfig;
}

export class NoActiveSeason extends Error {}

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Persists a duel the Fighter just started with a seed ticket, with the bot config snapshot and encrypted seed. */
@Injectable()
export class DuelRecorder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seeds: BotSeedStore,
  ) {}

  async record(input: RecordDuelInput): Promise<BotConfigSnapshot> {
    const strategy = STRATEGIES[input.level];
    if (!strategy) throw new Error(`No strategy for bot level ${input.level}`);
    const pending = await this.prisma.pendingTicket.findUnique({
      where: { seedHash: input.seedHash },
    });

    return this.prisma.$transaction(async (tx) => {
      const bot = await tx.bot.upsert({
        where: { address: input.botAccount },
        create: {
          address: input.botAccount,
          name: strategy.name,
          level: input.level,
          strategy: strategy.name.toLowerCase(),
          config: {},
        },
        update: {},
      });
      // Stored config overlays the defaults; later edits to the bot never change a duel that already exists.
      const snapshot: BotConfigSnapshot = {
        level: input.level,
        strategy: bot.strategy,
        config: resolveBotConfig(input.level, bot.config),
      };

      const season = await tx.season.findFirst({
        where: { startAt: { lte: new Date() } },
        orderBy: { startAt: 'desc' },
        select: { id: true },
      });
      if (!season) throw new NoActiveSeason('no season has started');

      await tx.fighter.createMany({ data: [{ address: input.fighter }], skipDuplicates: true });
      await this.dropRowOfAnotherDeployment(tx, input);
      const data = {
        counted: true,
        botConfig: snapshot as object,
        startAt: new Date(input.startMs),
        createdTxHash: input.txHash ?? null,
      };
      await tx.duel.upsert({
        where: { id: input.duelId },
        create: {
          id: input.duelId,
          seasonId: season.id,
          fighterAddress: input.fighter,
          botId: bot.id,
          assetId: input.assetId,
          ...data,
        },
        // The indexer sync may have created the row first with an empty snapshot.
        update: data,
      });

      if (pending) {
        await tx.botSeed.upsert({
          where: { duelId: input.duelId },
          create: { duelId: input.duelId, seedHash: input.seedHash, seed: pending.encryptedSeed },
          update: {},
        });
        await tx.pendingTicket.delete({ where: { seedHash: input.seedHash } });
      }
      return snapshot;
    });
  }

  /**
   * Duel ids restart at 1 on every deployment, so a row left by an earlier deployment can hold the id of a duel that
   * was only just created. Updating it in place would keep its old status, hit points and winner, and the arena
   * would show a finished duel. A row the indexer already made for this very duel has the same start time and is
   * kept; any other start time means the row belongs to something else, so it goes with everything attached to it.
   */
  private async dropRowOfAnotherDeployment(tx: Tx, input: RecordDuelInput) {
    const existing = await tx.duel.findUnique({
      where: { id: input.duelId },
      select: { startAt: true },
    });
    if (!existing?.startAt || existing.startAt.getTime() === input.startMs) return;
    await tx.duelTx.deleteMany({ where: { duelId: input.duelId } });
    await tx.position.deleteMany({ where: { duelId: input.duelId } });
    await tx.botSeed.deleteMany({ where: { duelId: input.duelId } });
    await tx.duel.delete({ where: { id: input.duelId } });
  }
}

export { botConfigSchema };
