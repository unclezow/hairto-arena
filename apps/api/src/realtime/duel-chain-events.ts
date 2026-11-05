import { Injectable } from '@nestjs/common';
import type { ChainDuelEvent } from '../duels/onchain-steps.js';
import { ArenaClient } from '../near/arena.client.js';

export type { ChainDuelEvent };

export interface ChainDuelInfo {
  fighter: string;
  bot: string;
  botLevel: number;
  assetId: number;
  /** The arena duel's `start_ms`. */
  startMs: number;
  /** Character the Fighter has equipped (cosmetic, provisional), 0 = default. */
  fighterCharacter: number;
}

/** Where duel events come from. An interface, so tests can run without a node. */
export interface DuelEventSource {
  /** Position of the newest event the source can serve (a block height). */
  head(): Promise<bigint>;
  fetch(fromBlock: bigint, toBlock: bigint): Promise<ChainDuelEvent[]>;
  loadDuel(id: bigint): Promise<ChainDuelInfo | null>;
}

export const DUEL_EVENT_SOURCE = Symbol('DUEL_EVENT_SOURCE');

/**
 * Stand-in until the indexer change brings the arena's events: it serves none, so the publisher stays idle,
 * while `loadDuel` already reads the arena. REST and the snapshot carry the duel in the meantime.
 */
@Injectable()
export class PendingDuelEventSource implements DuelEventSource {
  constructor(private readonly arena: ArenaClient) {}

  async head() {
    return 0n;
  }

  async fetch(): Promise<ChainDuelEvent[]> {
    return [];
  }

  async loadDuel(id: bigint): Promise<ChainDuelInfo | null> {
    const duel = await this.arena.getDuel(id);
    if (!duel) return null;
    return {
      fighter: duel.fighter,
      bot: duel.bot,
      botLevel: duel.bot_level,
      assetId: duel.asset_id,
      startMs: duel.start_ms,
      fighterCharacter: 0,
    };
  }
}
