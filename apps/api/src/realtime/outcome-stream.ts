import { Injectable, Logger } from '@nestjs/common';
import { parseEventLog } from '@hairto-arena/shared';
import type { FinalExecutionOutcome } from 'near-kit';
import { RedisService } from '../redis/redis.service.js';

/** A duel event log with its index among all the logs of its receipt. */
export interface RelayedLog {
  logIndex: number;
  log: string;
}

/** One executed receipt of our arena, with its duel event logs. */
export interface RelayedReceipt {
  receiptId: string;
  executor: string;
  logs: RelayedLog[];
}

/** An entry of `chain:outcomes`: what a transaction logged in the arena, from a source we trust. */
export interface RelayedOutcome {
  txHash: string;
  receipts: RelayedReceipt[];
}

export const OUTCOME_STREAM = 'chain:outcomes';
const SEQ_KEY = 'chain:outcomes:seq';
/** About a day of duel transactions; older entries are long indexed. */
const MAX_LEN = 20_000;

/** Arena events the live duel view follows; everything else is left to the indexer. */
export const DUEL_EVENTS = new Set([
  'duel_created',
  'position_opened',
  'position_closed',
  'position_penalized',
  'duel_finished',
  'duel_forfeited',
  'duel_voided',
  'bot_seed_revealed',
]);

/**
 * The arena receipts of an executed transaction that logged duel events, failed receipts left out (their state
 * was reverted). Logs come from the RPC outcome, never from a client.
 */
export function relayedOutcome(
  outcome: FinalExecutionOutcome,
  arenaId: string,
  onlyDuel?: number,
): RelayedOutcome | null {
  const receipts: RelayedReceipt[] = [];
  for (const r of outcome.receipts_outcome ?? []) {
    const status = r.outcome.status as unknown;
    if (r.outcome.executor_id !== arenaId) continue;
    if (status && typeof status === 'object' && 'Failure' in status) continue;
    // The index is taken among all the receipt's logs, so a worker push and a Fighter relay of the same
    // transaction number its events alike, whatever each one filters out.
    const logs = (r.outcome.logs ?? [])
      .map((log, logIndex) => ({ logIndex, log }))
      .filter(({ log }) => {
        const ev = parseEventLog(log);
        if (!ev || ev.standard !== 'hairto' || !DUEL_EVENTS.has(ev.event)) return false;
        return onlyDuel === undefined || (ev.data as { duel_id?: number }).duel_id === onlyDuel;
      });
    if (logs.length > 0) receipts.push({ receiptId: r.id, executor: arenaId, logs });
  }
  const txHash = outcome.transaction?.hash;
  return receipts.length > 0 && txHash ? { txHash, receipts } : null;
}

/**
 * The Redis stream `chain:outcomes`. Entries are numbered 1, 2, 3, ... (stream id `<n>-0`), so the duel event
 * publisher can follow them with the same numeric cursor it would use for block heights.
 */
@Injectable()
export class OutcomeStream {
  private readonly logger = new Logger(OutcomeStream.name);

  constructor(private readonly redis: RedisService) {}

  async push(entry: RelayedOutcome): Promise<bigint> {
    const seq = BigInt(await this.redis.client.incr(SEQ_KEY));
    await this.redis.client.xadd(
      OUTCOME_STREAM,
      'MAXLEN',
      '~',
      MAX_LEN,
      `${seq}-0`,
      'outcome',
      JSON.stringify(entry),
    );
    return seq;
  }

  /** Pushes without ever failing the caller: a lost live update only means waiting for the indexer. */
  async pushQuietly(entry: RelayedOutcome | null): Promise<void> {
    if (!entry) return;
    await this.push(entry).catch((err: Error) =>
      this.logger.warn(`Could not relay ${entry.txHash}: ${err.message}`),
    );
  }

  async head(): Promise<bigint> {
    return BigInt((await this.redis.client.get(SEQ_KEY)) ?? 0);
  }

  async range(from: bigint, to: bigint): Promise<{ seq: bigint; outcome: RelayedOutcome }[]> {
    const entries = await this.redis.client.xrange(OUTCOME_STREAM, `${from}-0`, `${to}-0`);
    return entries.map(([id, fields]) => ({
      seq: BigInt(id.split('-')[0]!),
      outcome: JSON.parse(fields[fields.indexOf('outcome') + 1]!) as RelayedOutcome,
    }));
  }
}
