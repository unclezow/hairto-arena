import { Inject, Injectable } from '@nestjs/common';
import { AppException, conflict, forbidden } from '../common/errors.js';
import { DuelStatus } from '../generated/prisma/enums.js';
import { MarketStatusService } from '../price/market-status.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DUEL_CHAIN_READER, type DuelChainReader } from './duel-chain-reader.js';

export interface TicketRequestBody {
  assetId: number;
  botLevel: number;
}

export interface Eligibility {
  /** Whether this duel is eligible to affect the season score. */
  counted: boolean;
  /** Null means there is no daily counted-duel limit. */
  remainingCounted: number | null;
}

/**
 * A recorded duel younger than this still blocks a new ticket, even if the read model has not caught up with its
 * result yet: the round, the reveal grace and settling all fit in it.
 */
const RECENT_DUEL_MS = 90_000;

/** Everything checked before the worker signs a ticket, each with its reason code. */
@Injectable()
export class EligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly markets: MarketStatusService,
    @Inject(DUEL_CHAIN_READER) private readonly chain: DuelChainReader,
  ) {}

  async check(fighter: string, body: TicketRequestBody, now = new Date()): Promise<Eligibility> {
    await this.requireOpenMarket(body.assetId, now);
    await this.requireNoRunningDuel(fighter, now);
    await this.requireBot(body.botLevel);
    if (!(await this.chain.canPlay(fighter))) {
      throw forbidden(
        'Fighter principal in the vault is below the minimum to play',
        'NOT_ELIGIBLE',
      );
    }
    return { counted: true, remainingCounted: null };
  }

  /**
   * The market must be open and its display quote fresh. On-chain freshness is not checked here: ticks are only
   * pushed for assets in play, and the bot worker primes the asset before signing the ticket.
   */
  private async requireOpenMarket(assetId: number, now: Date) {
    const market = await this.markets.get(assetId, now);
    if (!market || market.closedReason === 'disabled' || market.closedReason === 'session') {
      throw conflict('ARENA_CLOSED', 'This market is closed right now');
    }
    if (market.closedReason === 'stale') {
      throw new AppException(
        503,
        'ORACLE_UNAVAILABLE',
        'The price feed for this asset is not fresh',
      );
    }
  }

  /** The arena keeps one pending or running duel per Fighter until it is settled or voided. */
  private async requireNoRunningDuel(fighter: string, now: Date) {
    const recent = await this.prisma.duel.findFirst({
      where: {
        fighterAddress: fighter,
        status: { in: [DuelStatus.CREATED, DuelStatus.ACTIVE] },
        startAt: { gt: new Date(now.getTime() - RECENT_DUEL_MS) },
      },
      select: { id: true },
    });
    if (recent || (await this.chain.activeDuelOf(fighter)) !== null) {
      throw conflict('DUEL_IN_PROGRESS', 'The fighter already has a duel in progress');
    }
  }

  private async requireBot(level: number) {
    const bot = await this.prisma.bot.findFirst({
      where: { level, active: true },
      select: { id: true },
    });
    if (!bot) throw new AppException(503, 'BOT_UNAVAILABLE', `No bot is enabled at level ${level}`);
  }
}
