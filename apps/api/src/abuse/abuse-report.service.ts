import { Injectable } from '@nestjs/common';
import { notFound } from '../common/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toJson } from '../admin/audit.service.js';

/**
 * What an operator should look at before results are posted: flags per rule, and which of the flagged fighters
 * are about to be paid a prize. It is a report; the prizes stay what the keeper computed.
 */
@Injectable()
export class AbuseReportService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(seasonId: number) {
    const [flags, prizes] = await Promise.all([
      this.prisma.fighterFlag.findMany({ where: { seasonId }, orderBy: { id: 'asc' } }),
      this.prisma.seasonResult.findMany({ where: { seasonId, kind: 'PRIZE' } }),
    ]);

    const rules = new Map<
      string,
      { rule: string; total: number; open: number; confirmed: number; dismissed: number }
    >();
    for (const f of flags) {
      const row = rules.get(f.rule) ?? {
        rule: f.rule,
        total: 0,
        open: 0,
        confirmed: 0,
        dismissed: 0,
      };
      row.total++;
      if (f.status === 'OPEN') row.open++;
      else if (f.status === 'CONFIRMED') row.confirmed++;
      else row.dismissed++;
      rules.set(f.rule, row);
    }

    const prizeOf = new Map(prizes.map((p) => [p.address, p]));
    const flagged = new Map<string, typeof flags>();
    for (const f of flags)
      flagged.set(f.fighterAddress, [...(flagged.get(f.fighterAddress) ?? []), f]);

    const prizeEligible = [...flagged.entries()]
      .filter(([address]) => prizeOf.has(address))
      .map(([address, list]) => ({
        address,
        rank: prizeOf.get(address)!.rank,
        prize: prizeOf.get(address)!.amount.toFixed(),
        rules: list.map((f) => ({ rule: f.rule, status: f.status, score: f.score })),
      }))
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));

    const report = {
      seasonId,
      totalFlags: flags.length,
      flaggedFighters: flagged.size,
      byRule: [...rules.values()],
      prizeEligibleFlagged: prizeEligible,
    };
    await this.prisma.abuseReport.upsert({
      where: { seasonId },
      create: { seasonId, report: toJson(report) as object },
      update: { report: toJson(report) as object, generatedAt: new Date() },
    });
    return report;
  }

  async get(seasonId: number) {
    const stored = await this.prisma.abuseReport.findUnique({ where: { seasonId } });
    if (!stored) throw notFound('No abuse report for this season yet');
    return { generatedAt: stored.generatedAt, ...(stored.report as object) };
  }
}
