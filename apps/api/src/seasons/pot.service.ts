import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { ParamsService } from '../config/params.service.js';
import type { Season } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BalanceService } from '../read-model/balance.service.js';
import {
  estimateVault,
  fighterPrize,
  potSplit,
  type VaultEstimate,
} from '../read-model/estimates.js';
import { toUnits } from '../read-model/wallet-status.service.js';

interface HarvestSum {
  vault: string;
  gross_yield: string;
  fee: string;
  to_owners: string;
  to_pot: string;
}

export interface VaultFlow {
  grossYield: bigint;
  fee: bigint;
  toOwners: bigint;
  toPot: bigint;
}

const ZERO: VaultFlow = { grossYield: 0n, fee: 0n, toOwners: 0n, toPot: 0n };

/** The season pot: what the vaults really paid in (harvests) and what the TVL says it will be. */
@Injectable()
export class PotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly params: ParamsService,
    private readonly balances: BalanceService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  get splitMode() {
    return this.config.get('VAULT_B_SPLIT_MODE', { infer: true });
  }

  /** Harvests inside the season window, summed per vault. */
  async actual(season: Season) {
    const rows = await this.prisma.$queryRaw<HarvestSum[]>`
      SELECT vault::text AS vault, COALESCE(SUM(gross_yield), 0)::text AS gross_yield, COALESCE(SUM(fee), 0)::text AS fee,
        COALESCE(SUM(to_owners), 0)::text AS to_owners, COALESCE(SUM(to_pot), 0)::text AS to_pot
      FROM harvests WHERE timestamp >= ${season.startAt} AND timestamp < ${season.endAt} GROUP BY vault`;

    const flow = (vault: string): VaultFlow => {
      const r = rows.find((x) => x.vault === vault);
      return r
        ? {
            grossYield: BigInt(r.gross_yield),
            fee: BigInt(r.fee),
            toOwners: BigInt(r.to_owners),
            toPot: BigInt(r.to_pot),
          }
        : { ...ZERO };
    };
    return this.summarize(flow('FIGHTER'), flow('BACKER'));
  }

  /** What the pot should be at the end of a season, from today's TVL and an assumed yield rate. */
  async estimate() {
    const tvl = await this.balances.tvl();
    const { fighter, backer } = this.params.vaults;
    const seasonSec = this.params.season.durationMs / 1000;
    const apyBps = this.config.get('ESTIMATE_APY_BPS', { infer: true });

    const a = estimateVault(
      { tvl: tvl.fighter, feeBps: fighter.feeBps, ownerShareBps: fighter.ownerShareBps },
      apyBps,
      seasonSec,
    );
    const b = estimateVault(
      {
        tvl: tvl.backer,
        feeBps: backer.feeBps,
        ownerShareBps: backer.ownerShareBps,
        splitMode: this.splitMode,
      },
      apyBps,
      seasonSec,
    );
    return {
      estimate: true as const,
      assumptions: {
        apyBps,
        seasonSec,
        fighterCount: tvl.fighterCount,
        backerCount: tvl.backerCount,
        vaultATvl: tvl.fighter,
        vaultBTvl: tvl.backer,
        vaultBSplitMode: this.splitMode,
      },
      ...this.summarize(a, b),
    };
  }

  /** The real pot once it has any money in it, the estimate before that. */
  async best(season: Season) {
    const actual = await this.actual(season);
    if (actual.pot > 0n) return { basis: 'actual' as const, estimate: false, ...actual };
    const estimate = await this.estimate();
    return { basis: 'estimate' as const, ...estimate };
  }

  amountsByRank(fighterPool: bigint): bigint[] {
    return this.params.prizeCurveBps.map((bps) => fighterPrize(fighterPool, bps));
  }

  minimums() {
    return {
      fighter: toUnits(this.params.vaults.fighter.minDepositUsd),
      backer: toUnits(this.params.vaults.backer.minDepositUsd),
    };
  }

  private summarize(a: VaultEstimate | VaultFlow, b: VaultEstimate | VaultFlow) {
    const pot = a.toPot + b.toPot;
    const { fighterPool, backerPool } = potSplit(pot, this.params.potSplit.fighterBps);
    const reconciles = (v: VaultFlow | VaultEstimate) =>
      v.fee + v.toOwners + v.toPot === v.grossYield;
    return {
      vaults: { fighter: a, backer: b },
      pot,
      fighterPool,
      backerPool,
      /** Fee + depositor share + pot equals the gross yield in both vaults. */
      reconciles: reconciles(a) && reconciles(b),
    };
  }
}
