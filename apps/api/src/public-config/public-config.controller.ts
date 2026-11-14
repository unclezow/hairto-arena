import { Controller, Get, Header } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { NearService } from '../near/near.service.js';
import { ParamsService } from '../config/params.service.js';
import { tiersOf } from '../read-model/prize-tiers.js';
import { toUnits } from '../read-model/wallet-status.service.js';

type Status = 'real' | 'simulated' | 'mock' | 'relayed' | 'none';

/** What runs for real and what is simulated, so clients never hardcode (or overstate) it. */
function realVersusSimulated(
  priceSource: 'mock' | 'pyth' | 'hyperliquid',
): { component: string; status: Status; note?: string }[] {
  return [
    { component: 'Duel, commit-reveal, damage and score', status: 'real', note: 'on-chain' },
    { component: 'Pot split and merkle claims', status: 'real', note: 'on-chain' },
    {
      component: 'Vault logic (principal, harvest, TWAB, minimums, fee)',
      status: 'real',
      note: 'on-chain',
    },
    { component: 'Trading positions', status: 'simulated', note: 'paper trades' },
    { component: 'Opponent', status: 'simulated', note: 'a configured bot, not another player' },
    {
      component: 'Yield source',
      status: 'simulated',
      note: 'the vault accrues yield at a set rate',
    },
    { component: 'Stablecoin', status: 'mock', note: 'test USDC with a faucet' },
    {
      component: 'Oracle prices',
      status: priceSource === 'mock' ? 'simulated' : 'relayed',
      note:
        priceSource === 'mock'
          ? 'seeded random walk'
          : `${priceSource === 'pyth' ? 'Pyth' : 'Hyperliquid'} prices pushed to the arena`,
    },
    { component: 'Yield and TVL', status: 'simulated', note: 'time is accelerated in the demo' },
    { component: 'Sponsors', status: 'none', note: 'not in the MVP' },
  ];
}

@Controller('config')
export class PublicConfigController {
  constructor(
    private readonly params: ParamsService,
    private readonly near: NearService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Minimums, fees, split, season rules and the real-versus-simulated table. */
  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  get() {
    const p = this.params;
    const d = this.near.deployment;
    return {
      network: d.network,
      rpcUrl: this.config.get('PUBLIC_RPC_URL', { infer: true }) ?? d.rpcUrl,
      explorerUrl: d.explorerUrl,
      contracts: d.contracts,
      bots: d.accounts.bots,
      minimums: {
        fighter: {
          usd: p.vaults.fighter.minDepositUsd,
          units: toUnits(p.vaults.fighter.minDepositUsd),
        },
        backer: {
          usd: p.vaults.backer.minDepositUsd,
          units: toUnits(p.vaults.backer.minDepositUsd),
        },
      },
      vaults: {
        fighter: { feeBps: p.vaults.fighter.feeBps, ownerShareBps: p.vaults.fighter.ownerShareBps },
        backer: { feeBps: p.vaults.backer.feeBps, ownerShareBps: p.vaults.backer.ownerShareBps },
        backerSplitMode: this.config.get('VAULT_B_SPLIT_MODE', { infer: true }),
      },
      potSplit: p.potSplit,
      season: {
        durationMs: p.season.durationMs,
        pickWindowMs: p.season.pickWindowMs,
        disputeWindowMs: p.season.disputeWindowMs,
        picksPerBacker: p.season.picksPerBacker,
      },
      duel: { roundMs: p.duel.roundDurationMs, countdownMs: p.duel.countdownMs },
      score: {
        pointsByBotLevel: p.score.pointsByBotLevel,
        pointsDraw: p.score.pointsDraw,
        minDuelsForLeaderboard: p.score.minDuelsForLeaderboard,
        maxCountedDuelsPerDay: p.score.maxCountedDuelsPerDay,
      },
      prizes: { ranks: p.prizeCurveBps.length, tiers: tiersOf(p.prizeCurveBps) },
      oracle: {
        maxStalenessMs: p.oracle.maxStalenessMs,
        voidAfterOutageMs: p.oracle.voidAfterOutageMs,
      },
      realVersusSimulated: realVersusSimulated(this.config.get('PRICE_SOURCE', { infer: true })),
    };
  }
}
