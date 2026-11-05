import type { FinalExecutionOutcome } from 'near-kit';

/** One NEP-297 event: `EVENT_JSON:{"standard","version","event","data"}` in a receipt's logs. */
export interface NearEvent<T = unknown> {
  standard: string;
  version: string;
  event: string;
  data: T;
}

const PREFIX = 'EVENT_JSON:';

/** Every NEP-297 event of a standard in the logs of all receipts of a transaction, in execution order. */
export function eventsOf(outcome: FinalExecutionOutcome, standard = 'hairto'): NearEvent[] {
  const out: NearEvent[] = [];
  for (const receipt of outcome.receipts_outcome ?? []) {
    for (const log of receipt.outcome.logs ?? []) {
      if (!log.startsWith(PREFIX)) continue;
      try {
        const event = JSON.parse(log.slice(PREFIX.length)) as NearEvent;
        if (event.standard === standard) out.push(event);
      } catch {
        // Not JSON after the prefix: not an event of ours.
      }
    }
  }
  return out;
}
