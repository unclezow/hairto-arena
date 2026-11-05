import { Injectable } from '@nestjs/common';
import { AppException, notFound } from '../common/errors.js';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { ParamsService } from '../config/params.service.js';
import type { Season } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FreshnessService } from '../read-model/freshness.service.js';
import { tiersOf } from '../read-model/prize-tiers.js';
import { SeasonLookup } from '../read-model/season-lookup.service.js';
import { PotService } from './pot.service.js';

@Injectable()
export class SeasonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seasons: SeasonLookup,
    private readonly pot: PotService,
    private readonly params: ParamsService,
    private readonly freshness: FreshnessService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async view(param: string | undefined) {
    const season = await this.seasons.require(param);
    return this.describe(season);
  }

  async potOf(param: string | undefined) {
    const season = await this.seasons.require(param);
    const [actual, estimate] = await Promise.all([this.pot.actual(season), this.pot.estimate()]);
    return {
      seasonId: season.id,
      fighterShareBps: this.params.potSplit.fighterBps,
      backerShareBps: this.params.potSplit.backerBps,
      vaultBSplitMode: this.pot.splitMode,
      actual,
      estimate,
      ...(await this.freshness.get()),
    };
  }

  async prizes(param: string | undefined) {
    const season = await this.seasons.require(param);
    const best = await this.pot.best(season);
    const amounts = this.pot.amountsByRank(best.fighterPool);
    const curve = this.params.prizeCurveBps;
    const total = curve.reduce((a, b) => a + b, 0);

    return {
      seasonId: season.id,
      prizeRanks: curve.length,
      totalBps: total,
      basis: best.basis,
      estimate: best.estimate,
      ...(best.estimate ? { assumptions: (best as { assumptions: unknown }).assumptions } : {}),
      fighterPool: best.fighterPool,
      tiers: tiersOf(curve).map((t) => ({
        ...t,
        percent: t.bps / 100,
        amountPerRank: amounts[t.from - 1] ?? 0n,
      })),
    };
  }

  /** A fighter's prize or a backer's bonus for a season, with the merkle proof to claim it. */
  async result(param: string, address: string) {
    const season = await this.seasons.require(param);
    // The keeper stores results before it posts them; they are not public until the chain has them.
    if (!season.resultsPostedAt) {
      throw new AppException(
        404,
        'RESULTS_NOT_POSTED',
        'The results of this season have not been posted yet',
      );
    }
    const result = await this.prisma.seasonResult.findFirst({
      where: { seasonId: season.id, address },
    });
    if (!result) throw notFound('No result for this account');

    const claim = await this.prisma.claim.findFirst({
      where: { seasonId: season.id, address, kind: result.kind },
    });
    const phase = this.seasons.phaseOf(season);
    return {
      seasonId: season.id,
      address,
      kind: result.kind,
      rank: result.rank,
      amount: result.amount,
      proof: result.proof,
      claimed: claim !== null,
      claimedTxHash: claim?.txHash ?? null,
      phase,
      // The proof is public once posted, but the contract only pays after the dispute window.
      claimable: phase === 'claimable' && claim === null,
    };
  }

  /** Posted, claimed and still unclaimed amounts of a season, so claimed can be seen never to exceed posted. */
  async claims(param: string | undefined) {
    const season = await this.seasons.require(param);
    const [results, claims, run] = await Promise.all([
      this.prisma.seasonResult.groupBy({
        by: ['kind'],
        where: { seasonId: season.id },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.claim.groupBy({
        by: ['kind'],
        where: { seasonId: season.id },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.seasonRun.findUnique({ where: { seasonId: season.id } }),
    ]);

    const sum = (
      rows: { kind: string; _sum: { amount: { toFixed(): string } | null } }[],
      kind: string,
    ) => BigInt(rows.find((r) => r.kind === kind)?._sum.amount?.toFixed() ?? '0');
    const count = (rows: { kind: string; _count: number }[], kind: string) =>
      rows.find((r) => r.kind === kind)?._count ?? 0;
    const row = (kind: 'PRIZE' | 'BONUS') => ({
      posted: sum(results, kind),
      claimed: sum(claims, kind),
      unclaimed: sum(results, kind) - sum(claims, kind),
      entries: count(results, kind),
      claims: count(claims, kind),
    });
    const prize = row('PRIZE');
    const bonus = row('BONUS');
    const posted = prize.posted + bonus.posted;
    const claimed = prize.claimed + bonus.claimed;

    return {
      seasonId: season.id,
      posted,
      claimed,
      unclaimed: posted - claimed,
      // Claimed above posted would mean a bug somewhere between the keeper, the contract and the indexer.
      reconciles: claimed <= posted,
      byKind: { prize, bonus },
      rollover: {
        dust: run?.dust ?? null,
        afterDays: this.config.get('KEEPER_ROLLOVER_DAYS', { infer: true }),
      },
    };
  }

  /** Unclaimed results whose claim period ends within `withinDays`, for operators (see the admin module). */
  async expiringClaims(seasonId: number, withinDays: number, now = new Date()) {
    const season = await this.seasons.require(String(seasonId));
    if (!season.resultsPostedAt) return [];
    const deadline = new Date(
      season.resultsPostedAt.getTime() +
        this.params.season.disputeWindowMs +
        this.config.get('KEEPER_ROLLOVER_DAYS', { infer: true }) * 86_400_000,
    );
    if (deadline.getTime() - now.getTime() > withinDays * 86_400_000) return [];

    const claimed = new Set(
      (
        await this.prisma.claim.findMany({
          where: { seasonId },
          select: { address: true, kind: true },
        })
      ).map((c) => `${c.address}:${c.kind}`),
    );
    const results = await this.prisma.seasonResult.findMany({ where: { seasonId } });
    return results
      .filter((r) => !claimed.has(`${r.address}:${r.kind}`))
      .map((r) => ({ address: r.address, kind: r.kind, amount: r.amount, deadline }));
  }

  private async describe(season: Season) {
    return {
      id: season.id,
      startAt: season.startAt,
      endAt: season.endAt,
      phase: this.seasons.phaseOf(season),
      indexerPhase: season.phase,
      prizeRoot: season.prizeRoot,
      bonusRoot: season.bonusRoot,
      resultsPostedAt: season.resultsPostedAt,
      ...this.seasons.timersOf(season),
      ...(await this.freshness.get()),
    };
  }
}
