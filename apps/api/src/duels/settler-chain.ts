import { Injectable } from '@nestjs/common';
import { ArenaClient } from '../near/arena.client.js';
import type { DuelStatusName } from '../near/arena.types.js';

export interface SettlerDuel {
  status: DuelStatusName;
  fighter: string;
  /** Round end, or the KO time, plus the reveal grace: `settle_duel` is accepted after it. */
  effectiveEndMs: number;
  settledMs: number | null;
}

/** What the settler needs from the arena. An interface, so tests can run without a node. */
export interface SettlerChain {
  /** Null once the duel was deleted (its seed was revealed, or it was pruned). */
  getDuel(duelId: bigint): Promise<SettlerDuel | null>;
  /** Settles, forfeits an idle Fighter, or voids on an oracle outage, all decided by the arena. */
  settleDuel(duelId: bigint): Promise<void>;
  voidDuel(duelId: bigint): Promise<void>;
  /** Deletes a terminal duel whose seed was not revealed in time; it records no score. */
  pruneDuel(duelId: bigint): Promise<void>;
}

export const SETTLER_CHAIN = Symbol('SETTLER_CHAIN');

/** These arena methods are permissionless; the keeper's function-call key only pays the gas. */
@Injectable()
export class NearSettler implements SettlerChain {
  constructor(private readonly arena: ArenaClient) {}

  async getDuel(duelId: bigint): Promise<SettlerDuel | null> {
    const duel = await this.arena.getDuel(duelId);
    if (!duel) return null;
    return {
      status: duel.status,
      fighter: duel.fighter,
      effectiveEndMs: duel.effective_end_ms,
      settledMs: duel.settled_ms,
    };
  }

  async settleDuel(duelId: bigint) {
    await this.arena.settleDuel(duelId);
  }

  async voidDuel(duelId: bigint) {
    await this.arena.voidDuel(duelId);
  }

  async pruneDuel(duelId: bigint) {
    await this.arena.pruneDuel(duelId);
  }
}
