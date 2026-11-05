import { Injectable, Logger } from '@nestjs/common';
import { DuelStatus } from '../generated/prisma/enums.js';
import { ArenaClient } from '../near/arena.client.js';
import type { DuelStatusName } from '../near/arena.types.js';
import { isTerminal, type DuelRow } from './duel-view.service.js';

const STATUS: Record<DuelStatusName, DuelStatus> = {
  Active: DuelStatus.ACTIVE,
  Finished: DuelStatus.FINISHED,
  Forfeited: DuelStatus.FORFEITED,
  Voided: DuelStatus.VOIDED,
};

/** The part of a duel view the chain can correct while the indexer is still catching up. */
export interface OverlayView {
  status: DuelStatus;
  winner: string | null;
  ko: boolean;
  hp: { fighter: number; bot: number };
  pointsAwarded: number;
  counted: boolean;
}

/**
 * The database learns about a settled duel only when the indexer reaches it. While the row still says the duel is
 * running, ask the arena instead: `get_duel` knows the status, winner, KO and hit points until the seed reveal
 * deletes the duel. A row the indexer has already finished is left alone, so the indexed data stays the record.
 * Points are recorded with the seed reveal and come from the indexer (`pointsFromChain` stays false here).
 * `statusFromChain` marks a status the indexer has not reached: the replay endpoint still refuses such a duel.
 */
@Injectable()
export class ChainDuelOverlay {
  private readonly logger = new Logger(ChainDuelOverlay.name);

  constructor(private readonly arena: ArenaClient) {}

  async apply<T extends OverlayView>(
    duel: DuelRow,
    view: T,
  ): Promise<T & { pointsFromChain: boolean; statusFromChain: boolean }> {
    const unchanged = { ...view, pointsFromChain: false, statusFromChain: false };
    if (isTerminal(duel.status)) return unchanged;
    try {
      const onChain = await this.arena.getDuel(duel.id);
      if (!onChain) return unchanged;
      const status = STATUS[onChain.status];
      if (!status || !isTerminal(status)) return unchanged;
      return {
        ...view,
        status,
        winner: onChain.winner,
        ko: onChain.ko,
        hp: { fighter: onChain.hp_fighter, bot: onChain.hp_bot },
        pointsFromChain: false,
        statusFromChain: true,
      };
    } catch (err) {
      this.logger.warn(`Duel ${duel.id}: could not read the arena: ${(err as Error).message}`);
      return unchanged;
    }
  }
}
