import { Injectable } from '@nestjs/common';
import { STABLE_DECIMALS } from '@hairto-arena/shared';
import { ParamsService } from '../config/params.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BalanceService, type Principal } from './balance.service.js';
import { SeasonLookup } from './season-lookup.service.js';

export type Role = 'none' | 'fighter' | 'backer';
export type PlayReason = 'WRONG_ROLE' | 'BELOW_MINIMUM_DEPOSIT';
export type PickReason =
  'NO_SEASON' | 'PICK_WINDOW_CLOSED' | 'WRONG_ROLE' | 'BELOW_MINIMUM_DEPOSIT' | 'ALREADY_PICKED';

export interface PlayStatus {
  canPlay: boolean;
  reason: PlayReason | null;
}

export interface PickStatus {
  canPick: boolean;
  reason: PickReason | null;
  seasonId: number | null;
  /** The fighter this backer already picked this season. */
  pickedFighter: string | null;
}

/** Base units of the stablecoin (6 decimals) for a whole-dollar amount. */
export const toUnits = (usd: number) => BigInt(usd) * 10n ** BigInt(STABLE_DECIMALS);

/** What a wallet may do right now, and why not (one account, one role). */
@Injectable()
export class WalletStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly params: ParamsService,
    private readonly seasons: SeasonLookup,
    private readonly balances: BalanceService,
  ) {}

  get minimums() {
    return {
      fighter: toUnits(this.params.vaults.fighter.minDepositUsd),
      backer: toUnits(this.params.vaults.backer.minDepositUsd),
    };
  }

  /** The role is whichever vault holds the wallet's money; both at once cannot happen on-chain. */
  roleOf(principal: Principal): Role {
    if (principal.fighter > 0n) return 'fighter';
    if (principal.backer > 0n) return 'backer';
    return 'none';
  }

  play(principal: Principal): PlayStatus {
    if (principal.backer > 0n) return { canPlay: false, reason: 'WRONG_ROLE' };
    if (principal.fighter < this.minimums.fighter)
      return { canPlay: false, reason: 'BELOW_MINIMUM_DEPOSIT' };
    return { canPlay: true, reason: null };
  }

  async pick(address: string, principal: Principal, now = new Date()): Promise<PickStatus> {
    const season = await this.seasons.current(now);
    if (!season)
      return { canPick: false, reason: 'NO_SEASON', seasonId: null, pickedFighter: null };

    const existing = await this.prisma.pick.findUnique({
      where: { seasonId_backerAddress: { seasonId: season.id, backerAddress: address } },
    });
    const base = { seasonId: season.id, pickedFighter: existing?.fighterAddress ?? null };

    if (principal.fighter > 0n) return { canPick: false, reason: 'WRONG_ROLE', ...base };
    if (principal.backer < this.minimums.backer)
      return { canPick: false, reason: 'BELOW_MINIMUM_DEPOSIT', ...base };
    if (this.seasons.phaseOf(season, now) !== 'pick-window')
      return { canPick: false, reason: 'PICK_WINDOW_CLOSED', ...base };
    if (existing) return { canPick: false, reason: 'ALREADY_PICKED', ...base };
    return { canPick: true, reason: null, ...base };
  }

  async forAddress(address: string) {
    const principal = await this.balances.principalOf(address);
    return {
      principal,
      role: this.roleOf(principal),
      play: this.play(principal),
      pick: await this.pick(address, principal),
    };
  }
}
