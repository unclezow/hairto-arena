import { Inject, Injectable, Logger } from '@nestjs/common';
import { DuelStatus, Dir } from '../generated/prisma/enums.js';
import type { Bot, Duel, Position } from '../generated/prisma/client.js';
import { CharactersService } from '../characters/characters.service.js';
import { ParamsService } from '../config/params.service.js';
import { RedisService } from '../redis/redis.service.js';
import {
  resolveDuel,
  type ClosedTrade,
  type DamageStrategy,
  type DuelOutcome,
} from './damage/damage-strategy.js';
import { DAMAGE_STRATEGY } from './damage/damage.provider.js';

export type DuelRow = Duel & { bot: Bot; positions: Position[] };

const TERMINAL = new Set<DuelStatus>([
  DuelStatus.FINISHED,
  DuelStatus.FORFEITED,
  DuelStatus.VOIDED,
]);
export const MISMATCH_COUNTER = 'duel:damage-mismatch';

export const isTerminal = (status: DuelStatus) => TERMINAL.has(status);

/** A draw has no winner. */
const winnerOf = (winner: string | null) => (winner === null || winner === '' ? null : winner);

/** Builds the public picture of a duel. An open position shows only that it exists, never its direction. */
@Injectable()
export class DuelViewService {
  private readonly logger = new Logger(DuelViewService.name);

  constructor(
    private readonly params: ParamsService,
    private readonly redis: RedisService,
    private readonly characters: CharactersService,
    @Inject(DAMAGE_STRATEGY) private readonly damage: DamageStrategy,
  ) {}

  outcomeOf(duel: DuelRow): DuelOutcome {
    // Revealed closes and settle-time penalties both carry the net PnL the arena scored, in event order.
    const trades: ClosedTrade[] = duel.positions
      .filter((p) => p.closedAt !== null && p.pnlPpm !== null)
      .sort((a, b) => a.closedAt!.getTime() - b.closedAt!.getTime() || a.id - b.id)
      .map((p) => ({ side: p.isBot ? 'bot' : 'fighter', pnlPpm: p.pnlPpm! }));
    return resolveDuel(this.damage, {
      startingHp: this.params.duel.startingHp,
      assetId: duel.assetId,
      trades,
    });
  }

  async view(duel: DuelRow) {
    const outcome = this.outcomeOf(duel);
    this.checkAgainstChain(duel, outcome);

    return {
      id: duel.id.toString(),
      status: duel.status,
      fighter: duel.fighterAddress,
      bot: { accountId: duel.bot.address, level: duel.bot.level, name: duel.bot.name },
      // Cosmetic: what the fighter had equipped when the duel was created, and the bot's fixed look.
      fighterCharacter: await this.characters.equippedAt(duel.fighterAddress, duel.createdAt),
      botCharacter: this.characters.botCharacter(duel.bot.level),
      assetId: duel.assetId,
      startAt: duel.startAt,
      endAt: duel.endAt,
      hp: { fighter: outcome.hpFighter, bot: outcome.hpBot },
      winner: winnerOf(duel.winner),
      ko: duel.ko,
      pointsAwarded: duel.pointsAwarded,
      counted: duel.counted,
      positions: duel.positions
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((p) => this.position(p)),
    };
  }

  private position(p: Position) {
    const closed = p.closedAt !== null;
    return {
      player: p.player,
      isBot: p.isBot,
      open: !closed,
      openedAt: p.openedAt,
      closedAt: p.closedAt,
      // A penalized position was never revealed, so it has a result but no direction.
      penalized: p.penalized,
      ...(closed
        ? {
            dir: p.dir === null ? null : p.dir === Dir.LONG ? 'LONG' : 'SHORT',
            pnlPpm: p.pnlPpm,
            selfDelta: p.selfDelta,
            opponentDelta: p.opponentDelta,
          }
        : {}),
    };
  }

  /** The chain decides. If our preview disagrees with a finished duel, say so loudly and count it. */
  private checkAgainstChain(duel: DuelRow, outcome: DuelOutcome) {
    if (duel.status !== DuelStatus.FINISHED) return;
    const expected =
      outcome.winner === 'draw'
        ? null
        : outcome.winner === 'fighter'
          ? duel.fighterAddress
          : duel.bot.address;
    if (expected !== winnerOf(duel.winner)) {
      this.logger.warn(
        `Damage preview disagrees with the chain for duel ${duel.id}: preview ${expected}, chain ${duel.winner}`,
      );
      void this.redis.client.incr(MISMATCH_COUNTER).catch(() => undefined);
    }
  }
}
