import { SCORE } from '@hairto-arena/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { forbidden } from '../common/errors.js';
import { ParamsService } from '../config/params.service.js';
import { DUEL_CHAIN_READER, type DuelChainReader } from '../duels/duel-chain-reader.js';
import { DuelStatus } from '../generated/prisma/enums.js';
import { UsdcClient } from '../near/usdc.client.js';
import { VaultClient } from '../near/vault.client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { startOfUtcDay } from '../bot/duel-recorder.js';
import { BalanceService, type Principal } from '../read-model/balance.service.js';
import { bonusEstimate } from '../read-model/estimates.js';
import { ScoreboardService } from '../read-model/scoreboard.service.js';
import { SeasonLookup } from '../read-model/season-lookup.service.js';
import { WalletStatusService } from '../read-model/wallet-status.service.js';
import { PotService } from '../seasons/pot.service.js';

@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly params: ParamsService,
    private readonly wallets: WalletStatusService,
    private readonly balances: BalanceService,
    private readonly scoreboard: ScoreboardService,
    private readonly seasons: SeasonLookup,
    private readonly pot: PotService,
    @Inject(DUEL_CHAIN_READER) private readonly chain: DuelChainReader,
    private readonly usdc: UsdcClient,
    private readonly vault: VaultClient,
  ) {}

  /** Role, balances, and what the wallet may do now with the reason when it may not. `live` reads the chain. */
  async status(address: string, live: boolean) {
    const { principal, source } = await this.principal(address, live);
    const season = await this.seasons.current();
    const play = this.wallets.play(principal);
    const pick = await this.wallets.pick(address, principal);
    const min = this.wallets.minimums;

    return {
      accountId: address,
      role: this.wallets.roleOf(principal),
      principal,
      source,
      wallet: await this.wallet(address),
      minimums: min,
      canPlay: play.canPlay,
      canPlayReason: play.reason,
      canPick: pick.canPick,
      canPickReason: pick.reason,
      pickedFighter: pick.pickedFighter,
      season: season ? { id: season.id, phase: this.seasons.phaseOf(season) } : null,
    };
  }

  async backer(address: string, live: boolean) {
    const { principal, source } = await this.principal(address, live);
    if (this.wallets.roleOf(principal) !== 'backer')
      throw forbidden('This wallet is not a Backer', 'WRONG_ROLE');

    const season = await this.seasons.current();
    const pick = season
      ? await this.prisma.pick.findUnique({
          where: { seasonId_backerAddress: { seasonId: season.id, backerAddress: address } },
        })
      : null;
    const pickWindow = await this.wallets.pick(address, principal);

    return {
      accountId: address,
      principal: principal.backer,
      source,
      claimableYield: await this.claimable(address),
      pick: pick && season ? await this.pickView(season.id, pick.fighterAddress) : null,
      canPick: pickWindow.canPick,
      canPickReason: pickWindow.reason,
      potContribution: await this.contribution(season, principal),
      estimatedBonus: await this.bonus(season, address, pick?.fighterAddress ?? null, principal),
      season: season ? { id: season.id, phase: this.seasons.phaseOf(season) } : null,
    };
  }

  async fighter(address: string, live: boolean) {
    const { principal, source } = await this.principal(address, live);
    if (this.wallets.roleOf(principal) !== 'fighter')
      throw forbidden('This wallet is not a Fighter', 'WRONG_ROLE');

    const season = await this.seasons.current();
    const minDuels = this.params.score.minDuelsForLeaderboard;
    const cap = this.params.score.maxCountedDuelsPerDay;
    const min = this.wallets.minimums.fighter;

    const played = await this.prisma.duel.count({
      where: {
        fighterAddress: address,
        status: { not: DuelStatus.VOIDED },
        createdAt: { gte: startOfUtcDay(new Date()) },
      },
    });
    const score = season ? await this.scoreboard.scoreOf(season.id, address) : null;
    const rank = season ? await this.scoreboard.rankOf(season.id, minDuels, address) : null;

    return {
      accountId: address,
      principal: principal.fighter,
      source,
      season: season ? { id: season.id, phase: this.seasons.phaseOf(season) } : null,
      points: score?.points ?? 0,
      duels: score?.duels ?? 0,
      rank: rank?.rank ?? null,
      duelsToQualify: Math.max(0, minDuels - (score?.duels ?? 0)),
      duelsToday: played,
      dailyCap: cap,
      remainingCounted: null,
      prizesClaimable: await this.claimablePrizes(address),
      withdrawal: {
        minimum: min,
        principal: principal.fighter,
        // Anything above the minimum can leave without losing the right to play.
        maxWithdrawKeepingEligibility: principal.fighter > min ? principal.fighter - min : 0n,
        belowMinimumConsequence: 'CANNOT_PLAY_UNTIL_REDEPOSIT',
      },
    };
  }

  private async principal(
    address: string,
    live: boolean,
  ): Promise<{ principal: Principal; source: 'database' | 'chain' }> {
    if (live) {
      try {
        // One account holds one pool; its principal belongs to whichever pool its role names.
        const [role, amount] = await Promise.all([
          this.chain.roleOf(address),
          this.chain.principalOf(address),
        ]);
        return {
          principal: {
            fighter: role === 'Fighter' ? amount : 0n,
            backer: role === 'Backer' ? amount : 0n,
          },
          source: 'chain',
        };
      } catch (err) {
        this.logger.warn(`Live balance unavailable, using the database: ${(err as Error).message}`);
      }
    }
    return { principal: await this.balances.principalOf(address), source: 'database' };
  }

  /**
   * USDC in the wallet and whether the account is registered with the USDC token and the vault (both need a
   * one-time NEAR storage deposit before the first deposit). Null fields mean the chain could not be read.
   */
  private async wallet(address: string) {
    const [usdc, usdcStorage, vaultStorage] = await Promise.all([
      this.usdc.balanceOf(address).catch(() => null),
      this.usdc.storageBalanceOf(address).catch(() => undefined),
      this.vault.storageBalanceOf(address).catch(() => undefined),
    ]);
    return {
      usdc,
      usdcRegistered: usdcStorage === undefined ? null : usdcStorage !== null,
      vaultRegistered: vaultStorage === undefined ? null : vaultStorage !== null,
    };
  }

  private async claimable(address: string): Promise<bigint | null> {
    try {
      return await this.chain.claimableYieldOf(address);
    } catch {
      // The database has no copy of this number; say so rather than show zero.
      return null;
    }
  }

  private async pickView(seasonId: number, fighter: string) {
    const minDuels = this.params.score.minDuelsForLeaderboard;
    const [rank, score] = await Promise.all([
      this.scoreboard.rankOf(seasonId, minDuels, fighter),
      this.scoreboard.scoreOf(seasonId, fighter),
    ]);
    return {
      fighter,
      rank: rank?.rank ?? null,
      points: score?.points ?? 0,
      duels: score?.duels ?? 0,
    };
  }

  /** The Backer's slice of the Backer pool's pot money, in proportion to principal. Always an estimate. */
  private async contribution(
    season: Awaited<ReturnType<SeasonLookup['current']>>,
    principal: Principal,
  ) {
    const assumptions = {
      basis: 'share of the Backer pool principal',
      source: 'harvests of the current season',
    };
    if (!season) return { value: 0n, estimate: true as const, assumptions };
    const [actual, tvl] = await Promise.all([this.pot.actual(season), this.balances.tvl()]);
    const share =
      tvl.backer > 0n ? (actual.vaults.backer.toPot * principal.backer) / tvl.backer : 0n;
    return {
      value: share,
      estimate: true as const,
      assumptions: { ...assumptions, vaultBTvl: tvl.backer },
    };
  }

  /** `BonusPool x (prize_f / totalPrize) x (TWAB_i / TWAB_total_f)`, with today's principal standing in for TWAB. */
  private async bonus(
    season: Awaited<ReturnType<SeasonLookup['current']>>,
    address: string,
    fighter: string | null,
    principal: Principal,
  ) {
    const zero = (reason: string) => ({
      value: 0n,
      estimate: true as const,
      reason,
      assumptions: {},
    });
    if (!season) return zero('NO_SEASON');
    if (!fighter) return zero('NO_PICK');

    const minDuels = this.params.score.minDuelsForLeaderboard;
    const curve = this.params.prizeCurveBps;
    const rank = await this.scoreboard.rankOf(season.id, minDuels, fighter);
    if (!rank || rank.rank > curve.length) return zero('PICKED_FIGHTER_NOT_IN_PRIZE_RANKS');

    const [best, rankedCount, twab] = await Promise.all([
      this.pot.best(season),
      this.scoreboard.rankedCount(season.id, minDuels),
      this.twabOfBackersOf(season.id, fighter),
    ]);
    const filled = Math.min(rankedCount, curve.length);
    const totalPrizeBps = curve.slice(0, filled).reduce((a, b) => a + b, 0);

    const value = bonusEstimate({
      backerPool: best.backerPool,
      pickedFighterPrizeBps: curve[rank.rank - 1]!,
      totalPrizeBps,
      myTwab: principal.backer,
      totalTwabOfPickedFighter: twab,
    });
    return {
      value,
      estimate: true as const,
      reason: value === 0n ? ('NOTHING_TO_SHARE_YET' as const) : null,
      assumptions: {
        potBasis: best.basis,
        backerPool: best.backerPool,
        pickedFighterRank: rank.rank,
        prizeRanksFilled: filled,
        totalPrizeBps,
        twabProxy: 'current principal',
        myPrincipal: principal.backer,
        backersOfPickedFighterPrincipal: twab,
        for: address,
      },
    };
  }

  private async twabOfBackersOf(seasonId: number, fighter: string): Promise<bigint> {
    const [row] = await this.prisma.$queryRaw<{ total: string }[]>`
      SELECT COALESCE(SUM(CASE d.action WHEN 'DEPOSIT' THEN d.amount WHEN 'WITHDRAW' THEN -d.amount ELSE 0 END), 0)::text AS total
      FROM deposits d JOIN picks p ON p.backer_address = d.address AND p.season_id = ${seasonId} AND p.fighter_address = ${fighter}
      WHERE d.vault = 'BACKER'`;
    return BigInt(row?.total ?? '0');
  }

  private async claimablePrizes(address: string) {
    const results = await this.prisma.seasonResult.findMany({ where: { address, kind: 'PRIZE' } });
    const claims = await this.prisma.claim.findMany({
      where: { address, kind: 'PRIZE' },
      select: { seasonId: true },
    });
    const claimed = new Set(claims.map((c) => c.seasonId));

    const out: { seasonId: number; rank: number | null; amount: unknown }[] = [];
    for (const r of results) {
      if (claimed.has(r.seasonId)) continue;
      const season = await this.prisma.season.findUnique({ where: { id: r.seasonId } });
      if (season && this.seasons.phaseOf(season) === 'claimable') {
        out.push({ seasonId: r.seasonId, rank: r.rank, amount: r.amount });
      }
    }
    return out;
  }

  /** Scored duels played today, and when the UTC day rolls over. The arena has no daily cap. */
  async daily(address: string, now = new Date()) {
    const start = startOfUtcDay(now);
    const played = await this.prisma.duel.count({
      where: {
        fighterAddress: address,
        status: { not: DuelStatus.VOIDED },
        createdAt: { gte: start },
      },
    });
    return {
      played,
      cap: SCORE.maxCountedDuelsPerDay,
      resetsAt: new Date(start.getTime() + 86_400_000).toISOString(),
    };
  }
}
