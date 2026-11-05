import { Injectable } from '@nestjs/common';
import type { BotLevel } from '@hairto-arena/shared';
import { botConfigSchema, resolveBotConfig } from '../bot/bot-config.js';
import { badRequest, notFound } from '../common/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService, type AuditContext } from './audit.service.js';
import { botParamProblems, type BotPatch } from './caps.js';

@Injectable()
export class AdminBotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const bots = await this.prisma.bot.findMany({ orderBy: { level: 'asc' } });
    return bots.map((bot) => ({
      ...bot,
      // What a duel started now would use: the defaults of the level with the stored values on top.
      effectiveConfig: resolveBotConfig(bot.level as BotLevel, bot.config),
    }));
  }

  /** Applies to duels created afterwards: every duel keeps the config snapshot it started with. */
  async update(ctx: AuditContext, id: number, patch: BotPatch) {
    const bot = await this.prisma.bot.findUnique({ where: { id } });
    if (!bot) throw notFound('No such bot');
    const level = bot.level as BotLevel;

    const problems = botParamProblems(level, patch.config?.params);
    if (problems.length) throw badRequest('Invalid bot configuration', problems);

    const stored = (bot.config ?? {}) as Record<string, unknown>;
    const storedParams = (stored.params ?? {}) as Record<string, number>;
    const next = {
      ...stored,
      ...patch.config,
      params: { ...storedParams, ...patch.config?.params },
    };
    // The merged result must still be a complete, valid config for the level.
    try {
      botConfigSchema.parse(resolveBotConfig(level, next));
    } catch (err) {
      throw badRequest('Invalid bot configuration', [
        { path: 'config', message: (err as Error).message },
      ]);
    }

    return this.audit.run(ctx, 'bot.update', `bot:${id}`, async (tx) => {
      const updated = await tx.bot.update({
        where: { id },
        data: {
          ...(patch.active === undefined ? {} : { active: patch.active }),
          ...(patch.config === undefined ? {} : { config: next as object }),
        },
      });
      return {
        before: { active: bot.active, config: bot.config },
        after: { active: updated.active, config: updated.config },
        result: updated,
      };
    });
  }
}
