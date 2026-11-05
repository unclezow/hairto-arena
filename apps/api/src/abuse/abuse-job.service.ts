import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { LeaderLock } from '../common/leader-lock.js';
import { FlagStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { toJson } from '../admin/audit.service.js';
import { AbuseConfig } from './abuse-config.js';
import { AbuseFlagsService } from './abuse-flags.service.js';
import { evaluate, type CountedDuel, type FighterSeasonData } from './rules.js';

export interface AbuseRunReport {
  seasons: number;
  fighters: number;
  created: number;
  refreshed: number;
}

const toSec = (d: Date) => Math.floor(d.getTime() / 1000);

/**
 * Looks at every season that is still running or waiting for its results, finds patterns, and records them as
 * flags. A flag that was reviewed (dismissed or confirmed) is never reopened or changed by the job.
 */
@Injectable()
export class AbuseJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AbuseJob.name);
  private timer?: NodeJS.Timeout;
  private readonly lock: LeaderLock;

  constructor(
    private readonly prisma: PrismaService,
    redis: RedisService,
    private readonly config: AbuseConfig,
    private readonly env: ConfigService<Env, true>,
    private readonly flags: AbuseFlagsService,
  ) {
    this.lock = new LeaderLock(redis, 'abuse:job', 120_000);
  }

  onModuleInit() {
    if (!this.env.get('ABUSE_ENABLED', { infer: true })) return;
    this.timer = setInterval(
      () => void this.runOnce().catch((e: Error) => this.logger.error(`Abuse job: ${e.message}`)),
      this.env.get('ABUSE_INTERVAL_MS', { infer: true }),
    );
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.lock.release();
  }

  async runOnce(now = new Date()): Promise<AbuseRunReport | null> {
    if (!(await this.lock.hold())) return null;
    const seasons = await this.prisma.season.findMany({
      where: { startAt: { lte: now }, resultsPostedAt: null },
    });
    const report: AbuseRunReport = {
      seasons: seasons.length,
      fighters: 0,
      created: 0,
      refreshed: 0,
    };

    for (const season of seasons) {
      const window = { from: toSec(season.startAt), to: Math.min(toSec(season.endAt), toSec(now)) };
      const data = await this.load(season.id, season.endAt);
      report.fighters += data.size;

      for (const [address, d] of data) {
        for (const finding of evaluate(d, this.config.thresholds, window)) {
          const existing = await this.prisma.fighterFlag.findUnique({
            where: {
              fighterAddress_seasonId_rule: {
                fighterAddress: address,
                seasonId: season.id,
                rule: finding.rule,
              },
            },
          });
          if (existing && existing.status !== FlagStatus.OPEN) continue;
          const data = { score: finding.score, evidence: toJson(finding.evidence) as object };
          if (existing) {
            await this.prisma.fighterFlag.update({ where: { id: existing.id }, data });
            report.refreshed++;
          } else {
            await this.prisma.fighterFlag.create({
              data: { fighterAddress: address, seasonId: season.id, rule: finding.rule, ...data },
            });
            report.created++;
          }
          await this.flags.syncStatus(this.prisma, address);
        }
      }
    }
    return report;
  }

  /** The facts the rules need, per fighter, for one season. */
  private async load(seasonId: number, to: Date) {
    const duels = await this.prisma.duel.findMany({
      where: { seasonId, status: { not: 'VOIDED' } },
      select: {
        fighterAddress: true,
        createdAt: true,
        startAt: true,
        counted: true,
        status: true,
        winner: true,
        bot: { select: { level: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const addresses = [...new Set(duels.map((d) => d.fighterAddress))];
    const deposits = await this.prisma.deposit.findMany({
      where: {
        vault: 'FIGHTER',
        address: { in: addresses },
        action: { in: ['DEPOSIT', 'WITHDRAW'] },
        timestamp: { lte: to },
      },
      orderBy: [{ blockNumber: 'asc' }, { logIndex: 'asc' }],
    });

    const out = new Map<string, FighterSeasonData>(
      addresses.map((a) => [a, { counted: [], startTimes: [], balanceEvents: [] }]),
    );
    for (const d of duels) {
      const entry = out.get(d.fighterAddress)!;
      entry.startTimes.push(toSec(d.startAt ?? d.createdAt));
      if (d.counted && d.status === 'FINISHED' && d.winner) {
        const result: CountedDuel['result'] =
          d.winner === 'fighter' ? 'win' : d.winner === 'draw' ? 'draw' : 'loss';
        entry.counted.push({ level: d.bot.level, result });
      }
    }
    for (const e of deposits) {
      const amount = BigInt(e.amount.toFixed());
      out.get(e.address)!.balanceEvents.push({
        at: toSec(e.timestamp),
        delta: e.action === 'DEPOSIT' ? amount : -amount,
      });
    }
    return out;
  }
}
