import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BotLevel } from '@hairto-arena/shared';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BOT_GATEWAY, type BotGateway } from './bot-gateway.js';
import { BotSeedStore } from './seed-store.js';

/** Arena statuses that end a duel. */
const TERMINAL = new Set(['Finished', 'Forfeited', 'Voided']);

export interface RevealReport {
  revealed: number[];
  flagged: number[];
}

/**
 * Reveals the seed of every terminal duel with `reveal_bot_seed` (keeper account, final), and flags the ones that
 * stay unrevealed too long: the arena then records no score and the duel can be pruned.
 */
@Injectable()
export class SeedRevealer {
  private readonly logger = new Logger(SeedRevealer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly seeds: BotSeedStore,
    private readonly config: ConfigService<Env, true>,
    @Inject(BOT_GATEWAY) private readonly gateway: BotGateway,
  ) {}

  async run(): Promise<RevealReport> {
    const report: RevealReport = { revealed: [], flagged: [] };
    const timeoutMs = this.config.get('BOT_REVEAL_TIMEOUT_SEC', { infer: true }) * 1000;

    const open = await this.prisma.botSeed.findMany({
      where: { revealedAt: null, unrevealedAt: null, seed: { not: null } },
      include: { duel: { include: { bot: true } } },
    });

    for (const row of open) {
      const id = Number(row.duelId);
      try {
        const chainDuel = await this.gateway.getDuel(row.duelId);
        const seed = this.seeds.decrypt(row.seed!);
        if (!chainDuel) {
          // The arena deletes a duel once its seed is revealed (or it was pruned): nothing left to send, and
          // the seed of a finished duel may be public.
          await this.prisma.botSeed.update({
            where: { duelId: row.duelId },
            data: { seed, revealedAt: new Date() },
          });
          this.logger.warn(`Duel ${id} is gone from the arena; seed marked revealed`);
          report.revealed.push(id);
          continue;
        }
        if (TERMINAL.has(chainDuel.status)) {
          await this.gateway.revealSeed(row.duel.bot.level as BotLevel, row.duelId, seed);
          await this.prisma.botSeed.update({
            where: { duelId: row.duelId },
            data: { seed, revealedAt: new Date() },
          });
          report.revealed.push(id);
          continue;
        }
      } catch (err) {
        this.logger.warn(`Reveal of duel ${id} failed, will retry: ${(err as Error).message}`);
      }

      if (Date.now() - row.duel.createdAt.getTime() > timeoutMs) {
        await this.prisma.botSeed.update({
          where: { duelId: row.duelId },
          data: { unrevealedAt: new Date() },
        });
        this.logger.error(`Duel ${id}: seed still unrevealed after ${timeoutMs / 1000}s, flagged`);
        report.flagged.push(id);
      }
    }
    return report;
  }
}
