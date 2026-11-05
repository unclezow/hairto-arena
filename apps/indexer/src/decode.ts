import {
  EVENT_VERSION,
  HAIRTO_STANDARD,
  NEP245_STANDARD,
  parseEventLog,
} from '@hairto-arena/shared';
import type { ContractRole } from './handlers/index.js';
import type { EventMeta } from './handlers/store.js';
import type { NeardataBlock } from './neardata/types.js';

/** Our contract accounts, by role. Only their receipts are read. */
export type ContractIds = Record<ContractRole, string>;

export interface DecodedEvent extends EventMeta {
  standard: string;
  version: string;
  event: string;
  data: unknown;
  /** Which of our contracts emitted it. */
  role: ContractRole;
}

const isFailure = (status: unknown) =>
  typeof status === 'object' && status !== null && 'Failure' in status;

/**
 * Accepted events of one block, in shard, outcome and log order. An outcome counts only when its executor is one
 * of our contracts and it did not fail (a failed receipt's state was reverted, so its logs never happened).
 * Accepted: `hairto` 1.0.0 from any of them, `nep245` 1.0.0 only from the characters contract. `log_index`
 * numbers the accepted events of the block from 0.
 */
export function decodeBlock(block: NeardataBlock, contracts: ContractIds): DecodedEvent[] {
  const roleOf = new Map<string, ContractRole>(
    (Object.entries(contracts) as [ContractRole, string][]).map(([role, id]) => [id, role]),
  );
  const height = BigInt(block.block.header.height);
  const timestampMs = BigInt(block.block.header.timestamp_nanosec) / 1_000_000n;
  const out: DecodedEvent[] = [];

  for (const shard of block.shards ?? []) {
    for (const ro of shard.receipt_execution_outcomes ?? []) {
      const { id, outcome } = ro.execution_outcome;
      const role = roleOf.get(outcome.executor_id);
      if (!role || isFailure(outcome.status)) continue;
      for (const log of outcome.logs ?? []) {
        const parsed = parseEventLog(log);
        if (!parsed || parsed.version !== EVENT_VERSION) continue;
        const standardOk =
          parsed.standard === HAIRTO_STANDARD ||
          (parsed.standard === NEP245_STANDARD && role === 'characters');
        if (!standardOk) continue;
        out.push({
          standard: parsed.standard,
          version: parsed.version,
          event: parsed.event,
          data: parsed.data,
          role,
          block: { height, timestampMs },
          position: { logIndex: out.length },
          receiptId: id,
          txHash: ro.tx_hash ?? null,
          executor: outcome.executor_id,
        });
      }
    }
  }
  return out;
}
