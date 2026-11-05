import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { ParamsService } from '../config/params.service.js';
import { computeSeasonResults, type SeasonResults } from '../economics/results.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { INDEXER_LAG_KEY } from '../redis/keys.js';
import { RedisService } from '../redis/redis.service.js';
import { AbuseReportService } from '../abuse/abuse-report.service.js';
import { SeasonInputsLoader } from './inputs-loader.js';
import { KeeperModeService } from './keeper-mode.js';
import { assertMerkleSelfCheck, EMPTY_ROOT } from '../economics/merkle.js';
import {
  KEEPER_CHAIN,
  type ChainSeason,
  type KeeperChain,
  type PostedResults,
} from './keeper-chain.js';

export type SeasonAction =
  | 'idle'
  | 'closed'
  | 'computed'
  | 'posted'
  | 'dry-run'
  | 'dispute'
  | 'finalized'
  | 'rolled-over'
  | 'recomputed-after-rejection'
  | `blocked:${string}`;

export interface SeasonReport {
  seasonId: number;
  action: SeasonAction;
}

export class TwabMismatch extends Error {}

/** The roots and totals `post_results` expects; an empty side is posted as a zero root with a zero total. */
export function toPostedResults(seasonId: number, results: SeasonResults): PostedResults {
  const prizeTotal = results.prizes.reduce((sum, p) => sum + p.amount, 0n);
  const bonusTotal = results.bonuses.reduce((sum, b) => sum + b.amount, 0n);
  return {
    season: seasonId,
    prizeRoot: prizeTotal === 0n ? EMPTY_ROOT : results.prizeTree.root,
    bonusRoot: bonusTotal === 0n ? EMPTY_ROOT : results.bonusTree.root,
    prizeTotal,
    bonusTotal,
  };
}

const lockKey = (id: number) => `keeper:season:${id}`;
const LOCK_SEC = 120;

/**
 * Walks every season through its end: `close_season`, compute who gets what from the indexed data, cross-check the
 * TWABs against `vault.twab_of`, post the merkle roots with `post_results`, wait out the dispute window, and finally
 * `rollover_unclaimed`. The arena decides where a season is; every step looks at it first and is safe to repeat.
 */
@Injectable()
export class SeasonKeeper {
  private readonly logger = new Logger(SeasonKeeper.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly params: ParamsService,
    private readonly config: ConfigService<Env, true>,
    private readonly inputs: SeasonInputsLoader,
    private readonly mode: KeeperModeService,
    private readonly abuse: AbuseReportService,
    @Inject(KEEPER_CHAIN) private readonly chain: KeeperChain,
  ) {}

  async runOnce(): Promise<SeasonReport[]> {
    const mode = await this.mode.get();
    if (mode === 'off') return [];

    // Season timing follows the chain's clock, never this machine's.
    const now = new Date(await this.chain.now());
    const seasons = await this.prisma.season.findMany({
      where: {
        startAt: { lte: now },
        // Finalized seasons stay in the loop until their unclaimed funds are rolled over.
        OR: [{ run: null }, { run: { state: { not: 'rolled-over' } } }],
      },
      orderBy: { id: 'asc' },
    });

    const reports: SeasonReport[] = [];
    for (const season of seasons) {
      const locked = await this.redis.client.set(lockKey(season.id), '1', 'EX', LOCK_SEC, 'NX');
      if (locked !== 'OK') continue;
      try {
        reports.push({ seasonId: season.id, action: await this.advance(season.id, mode) });
      } catch (err) {
        this.logger.error(`Season ${season.id}: ${(err as Error).message}`);
        await this.recordError(season.id, (err as Error).message);
        reports.push({
          seasonId: season.id,
          action: `blocked:${err instanceof TwabMismatch ? 'twab-mismatch' : 'error'}`,
        });
      } finally {
        await this.redis.client.del(lockKey(season.id));
      }
    }
    return reports;
  }

  private async advance(seasonId: number, mode: 'live' | 'dry-run'): Promise<SeasonAction> {
    const chain = await this.chain.getSeason(seasonId);
    const now = await this.chain.now();
    if (!chain) return 'idle';

    switch (chain.phase) {
      case 'Picking':
      case 'Active':
        // close_season fails before end + close delay, so the last duels can settle and score.
        return now >= chain.endMs + chain.closeDelayMs ? this.close(seasonId, mode) : 'idle';
      case 'Closed':
        return this.computeAndPost(seasonId, chain, mode);
      default:
        return this.afterPosted(seasonId, chain, now);
    }
  }

  private async close(seasonId: number, mode: 'live' | 'dry-run'): Promise<SeasonAction> {
    await this.saveRun(seasonId, { state: 'closing', dryRun: mode === 'dry-run', error: null });
    if (mode === 'dry-run') return 'dry-run';
    await this.chain.closeSeason();
    this.logger.log(`Season ${seasonId} closed`);
    return 'closed';
  }

  /** Compute from fresh reads, check against the chain, store, and post (unless dry run). */
  private async computeAndPost(
    seasonId: number,
    chain: ChainSeason,
    mode: 'live' | 'dry-run',
  ): Promise<SeasonAction> {
    const blocked = await this.notReady(seasonId);
    if (blocked) return `blocked:${blocked}`;

    const previous = await this.prisma.seasonRun.findUnique({ where: { seasonId } });
    const rejected = previous?.state === 'posted' || previous?.state === 'dispute';

    const pot = await this.chain.potOf(seasonId);
    const first = await this.inputs.load(seasonId, chain, pot);
    const second = await this.inputs.load(seasonId, chain, pot);
    const results = computeSeasonResults(first);
    // Data that changed between two reads (a sync landing mid-way) would give two different answers.
    if (results.inputsHash !== computeSeasonResults(second).inputsHash)
      return 'blocked:inputs-moving';

    await this.crossCheckTwab(chain, results);

    // The chain is back in `Closed` although we posted: the results were rejected. Sending the same roots
    // again would only be rejected again, so wait until the inputs differ.
    if (rejected && previous?.inputsHash === results.inputsHash) {
      await this.recordError(
        seasonId,
        'Results were rejected and the inputs have not changed since',
      );
      return 'blocked:rejected-unchanged';
    }
    await this.persist(seasonId, pot, results, mode === 'dry-run');
    await this.abuseReport(seasonId);
    if (mode === 'dry-run') return 'dry-run';

    // Never post a root this build cannot prove it computes the way the arena verifies.
    assertMerkleSelfCheck();
    const tx = await this.chain.postResults(toPostedResults(seasonId, results));
    await this.saveRun(seasonId, {
      state: 'posted',
      postedTxHash: tx,
      postedAt: new Date(),
      error: null,
    });
    this.logger.log(
      `Season ${seasonId} results posted: prize ${results.prizeTree.root}, bonus ${results.bonusTree.root}`,
    );
    return rejected ? 'recomputed-after-rejection' : 'posted';
  }

  /** For the operator to read before the results are final. A failure here must never hold back the results. */
  private async abuseReport(seasonId: number) {
    try {
      await this.abuse.generate(seasonId);
    } catch (err) {
      this.logger.warn(`Season ${seasonId}: abuse report failed: ${(err as Error).message}`);
    }
  }

  private async afterPosted(
    seasonId: number,
    chain: ChainSeason,
    now: number,
  ): Promise<SeasonAction> {
    const run = await this.prisma.seasonRun.findUnique({ where: { seasonId } });
    if (
      run?.prizeRoot &&
      (run.prizeRoot !== chain.prizeRoot || run.bonusRoot !== chain.bonusRoot)
    ) {
      // Someone else posted different roots. The keeper cannot undo that; the guardian can.
      await this.recordError(
        seasonId,
        `On-chain roots differ from the computed ones (${chain.prizeRoot}, ${chain.bonusRoot})`,
      );
      this.logger.error(`Season ${seasonId}: on-chain roots differ from the computed ones`);
    }
    if (chain.phase !== 'Finalized' && now < chain.claimOpensMs) {
      await this.saveRun(seasonId, { state: 'dispute' });
      return 'dispute';
    }
    if (chain.rolledOver) {
      await this.saveRun(seasonId, { state: 'rolled-over' });
      return 'rolled-over';
    }
    if (now >= chain.claimOpensMs + chain.claimPeriodMs) {
      await this.chain.rolloverUnclaimed(seasonId);
      await this.saveRun(seasonId, { state: 'rolled-over' });
      this.logger.log(`Season ${seasonId}: unclaimed funds rolled over`);
      return 'rolled-over';
    }
    await this.saveRun(seasonId, { state: 'finalized' });
    return 'finalized';
  }

  /** Reasons to wait before computing money. Unknown counts as not ready. */
  private async notReady(seasonId: number): Promise<string | null> {
    const season = await this.prisma.season.findUnique({ where: { id: seasonId } });
    if (season?.phase === 'active' || !season) return 'waiting-for-index';

    const lag = await this.redis.client.get(INDEXER_LAG_KEY);
    if (lag === null) return 'indexer-unknown';
    if (Number(lag) > this.config.get('KEEPER_MAX_INDEXER_LAG_BLOCKS', { infer: true }))
      return 'indexer-lag';
    return null;
  }

  /** The contract's own TWAB is the reference; refuse to post a root built on a different number. */
  private async crossCheckTwab(chain: ChainSeason, results: SeasonResults) {
    const tolerance = BigInt(this.config.get('KEEPER_TWAB_TOLERANCE_BPS', { infer: true }));
    for (const [backer, offChain] of results.twabByBacker) {
      const onChain = await this.chain.twabOf(backer, chain.startMs, chain.endMs);
      const diff = onChain > offChain ? onChain - offChain : offChain - onChain;
      const allowed = onChain > 0n ? (onChain * tolerance) / 10_000n : 0n;
      if (diff > (allowed > 1n ? allowed : 1n)) {
        throw new TwabMismatch(`TWAB of ${backer}: indexed ${offChain}, chain ${onChain}`);
      }
    }
  }

  private async persist(seasonId: number, pot: bigint, results: SeasonResults, dryRun: boolean) {
    const rankOf = new Map(results.ranked.map((f) => [f.address, f.rank]));
    const fighterOfBacker = new Map(results.bonuses.map((b) => [b.address, b.fighter]));

    await this.prisma.$transaction([
      this.prisma.seasonResult.deleteMany({ where: { seasonId } }),
      this.prisma.seasonResult.createMany({
        data: [
          ...results.prizes.map((p) => ({
            seasonId,
            address: p.address,
            kind: 'PRIZE' as const,
            rank: p.rank,
            amount: p.amount.toString(),
            proof: results.prizeTree.proofs.get(p.address) ?? [],
          })),
          ...results.bonuses.map((b) => ({
            seasonId,
            address: b.address,
            kind: 'BONUS' as const,
            // The rank of the fighter this backer picked.
            rank: rankOf.get(fighterOfBacker.get(b.address)!) ?? null,
            amount: b.amount.toString(),
            proof: results.bonusTree.proofs.get(b.address) ?? [],
          })),
        ],
      }),
      this.prisma.season.update({ where: { id: seasonId }, data: { potAmount: pot.toString() } }),
      this.prisma.seasonRun.upsert({
        where: { seasonId },
        create: this.runData(seasonId, pot, results, dryRun),
        update: this.runData(seasonId, pot, results, dryRun),
      }),
    ]);
  }

  private runData(seasonId: number, pot: bigint, results: SeasonResults, dryRun: boolean) {
    return {
      seasonId,
      state: 'computed',
      inputsHash: results.inputsHash,
      prizeRoot: results.prizeTree.root,
      bonusRoot: results.bonusTree.root,
      pot: pot.toString(),
      payoutTotal: results.payoutTotal.toString(),
      dust: results.dust.toString(),
      dryRun,
      error: null,
      computedAt: new Date(),
    } satisfies Prisma.SeasonRunUncheckedCreateInput;
  }

  private saveRun(seasonId: number, data: Partial<Prisma.SeasonRunUncheckedUpdateInput>) {
    return this.prisma.seasonRun.upsert({
      where: { seasonId },
      create: {
        seasonId,
        state: 'closing',
        ...(data as object),
      } as Prisma.SeasonRunUncheckedCreateInput,
      update: data,
    });
  }

  private recordError(seasonId: number, error: string) {
    return this.saveRun(seasonId, { error: error.slice(0, 500) }).catch(() => undefined);
  }
}
