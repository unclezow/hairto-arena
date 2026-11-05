import { Injectable } from '@nestjs/common';
import { parseEventLog, type ArenaEvents } from '@hairto-arena/shared';
import type { ChainDuelEvent } from '../duels/onchain-steps.js';
import { ArenaClient } from '../near/arena.client.js';
import { OutcomeStream, type RelayedOutcome } from './outcome-stream.js';

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
  /** Position of the newest entry the source can serve (a sequence number that only grows). */
  head(): Promise<bigint>;
  fetch(from: bigint, to: bigint): Promise<ChainDuelEvent[]>;
  loadDuel(id: bigint): Promise<ChainDuelInfo | null>;
}

export const DUEL_EVENT_SOURCE = Symbol('DUEL_EVENT_SOURCE');

const DIR = { Long: 1, Short: 2 } as const;

/** The live duel events of one relayed outcome, in log order. `seq` is its position in `chain:outcomes`. */
export function duelEventsOf(outcome: RelayedOutcome, seq: bigint): ChainDuelEvent[] {
  const events: ChainDuelEvent[] = [];
  for (const receipt of outcome.receipts) {
    for (const { logIndex, log } of receipt.logs) {
      const parsed = parseEventLog(log);
      if (!parsed || parsed.standard !== 'hairto') continue;
      const where = {
        txHash: outcome.txHash,
        receiptId: receipt.receiptId,
        block: seq,
        logIndex,
      };
      const ev = mapEvent(parsed.event, parsed.data);
      if (ev) events.push({ ...where, ...ev } as ChainDuelEvent);
    }
  }
  return events;
}

type Where = 'txHash' | 'receiptId' | 'block' | 'logIndex';
type Mapped = ChainDuelEvent extends infer E ? (E extends unknown ? Omit<E, Where> : never) : never;

function mapEvent(event: string, data: unknown): Mapped | null {
  switch (event) {
    case 'duel_created': {
      const d = data as ArenaEvents['duel_created'];
      return { kind: 'created', id: BigInt(d.duel_id) };
    }
    case 'position_opened': {
      const d = data as ArenaEvents['position_opened'];
      return { kind: 'positionOpened', id: BigInt(d.duel_id), player: d.player, tick: d.open_tick };
    }
    case 'position_closed': {
      const d = data as ArenaEvents['position_closed'];
      return {
        kind: 'positionClosed',
        id: BigInt(d.duel_id),
        player: d.player,
        dir: DIR[d.dir],
        pnlPpm: d.net_pnl_ppm,
        selfDelta: d.self_delta,
        opponentDelta: d.opponent_delta,
      };
    }
    case 'position_penalized': {
      const d = data as ArenaEvents['position_penalized'];
      return {
        kind: 'positionPenalized',
        id: BigInt(d.duel_id),
        player: d.player,
        pnlPpm: d.net_pnl_ppm,
        selfDelta: d.self_delta,
        opponentDelta: d.opponent_delta,
      };
    }
    case 'duel_finished': {
      const d = data as ArenaEvents['duel_finished'];
      return { kind: 'finished', id: BigInt(d.duel_id), winner: d.winner, ko: d.ko };
    }
    case 'duel_forfeited': {
      const d = data as ArenaEvents['duel_forfeited'];
      return { kind: 'forfeited', id: BigInt(d.duel_id), loser: d.fighter };
    }
    case 'duel_voided': {
      const d = data as ArenaEvents['duel_voided'];
      return { kind: 'voided', id: BigInt(d.duel_id) };
    }
    case 'bot_seed_revealed': {
      const d = data as ArenaEvents['bot_seed_revealed'];
      return { kind: 'seedRevealed', id: BigInt(d.duel_id), seed: d.seed };
    }
    default:
      return null;
  }
}

/**
 * Live duel events from the Redis stream `chain:outcomes`, which holds only outcomes the backend fetched or
 * produced itself: the worker's own bot and keeper transactions, and Fighter transactions the API read from RPC.
 * Positions are stream sequence numbers. `loadDuel` reads the arena.
 */
@Injectable()
export class OutcomeEventSource implements DuelEventSource {
  constructor(
    private readonly stream: OutcomeStream,
    private readonly arena: ArenaClient,
  ) {}

  head() {
    return this.stream.head();
  }

  async fetch(from: bigint, to: bigint): Promise<ChainDuelEvent[]> {
    const entries = await this.stream.range(from, to);
    return entries.flatMap(({ seq, outcome }) => duelEventsOf(outcome, seq));
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
