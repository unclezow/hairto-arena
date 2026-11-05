import { Injectable } from '@nestjs/common';
import { ParamsService } from '../config/params.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { BalanceEvent } from '../economics/twab.js';
import type { ResultInputs } from '../economics/results.js';
import { toUnits } from '../read-model/wallet-status.service.js';
import type { ChainSeason } from './keeper-chain.js';

/** Collects what the results are computed from. Reading it twice and comparing the hashes catches data that moved. */
@Injectable()
export class SeasonInputsLoader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly params: ParamsService,
  ) {}

  async load(seasonId: number, chain: ChainSeason, pot: bigint): Promise<ResultInputs> {
    const [scores, picks] = await Promise.all([
      this.prisma.fighterSeasonScore.findMany({ where: { seasonId } }),
      this.prisma.pick.findMany({ where: { seasonId } }),
    ]);

    const backers = [...new Set(picks.map((p) => p.backerAddress))];
    const deposits = await this.prisma.deposit.findMany({
      where: { vault: 'BACKER', address: { in: backers }, action: { in: ['DEPOSIT', 'WITHDRAW'] } },
      orderBy: [{ blockNumber: 'asc' }, { logIndex: 'asc' }, { id: 'asc' }],
    });
    const balanceEvents = new Map<string, BalanceEvent[]>(backers.map((b) => [b, []]));
    for (const d of deposits) {
      const amount = BigInt(d.amount.toFixed());
      balanceEvents.get(d.address)!.push({
        at: d.timestamp.getTime(),
        delta: d.action === 'DEPOSIT' ? amount : -amount,
      });
    }

    return {
      seasonId,
      startMs: chain.startMs,
      endMs: chain.endMs,
      pot,
      fighterPotBps: this.params.potSplit.fighterBps,
      prizeCurveBps: this.params.prizeCurveBps,
      minDuels: this.params.score.minDuelsForLeaderboard,
      backerMinDeposit: toUnits(this.params.vaults.backer.minDepositUsd),
      scores: scores.map((s) => ({
        address: s.fighterAddress,
        points: s.points,
        wins: s.wins,
        duels: s.duels,
        reachedAt: s.reachedAt ? s.reachedAt.getTime() : null,
      })),
      picks: picks.map((p) => ({ backer: p.backerAddress, fighter: p.fighterAddress })),
      balanceEvents,
    };
  }
}
