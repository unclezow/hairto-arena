import { HAIRTO_STANDARD, parseEventLog, type HairtoEvents } from '@hairto-arena/shared';

/** The parts of a final execution outcome the app reads; wallets and near-kit both return this shape. */
interface OutcomeLike {
  transaction?: { hash?: string };
  transaction_outcome?: { id?: string };
  receipts_outcome?: { outcome?: { executor_id?: string; logs?: string[] } }[];
}

/** Hash of the transaction behind an outcome, or null when the wallet returned something else. */
export function txHashOf(outcome: unknown): string | null {
  const o = outcome as OutcomeLike | null;
  return o?.transaction?.hash ?? o?.transaction_outcome?.id ?? null;
}

export type ContractEvent = {
  [K in keyof HairtoEvents]: { event: K; data: HairtoEvents[K] };
}[keyof HairtoEvents];

/** `hairto` events logged by receipts that `contractId` executed, in order. Data arrays are flattened. */
export function eventsOf(outcome: unknown, contractId: string): ContractEvent[] {
  const receipts = (outcome as OutcomeLike | null)?.receipts_outcome ?? [];
  const events: ContractEvent[] = [];
  for (const receipt of receipts) {
    if (receipt.outcome?.executor_id !== contractId) continue;
    for (const log of receipt.outcome.logs ?? []) {
      const parsed = parseEventLog(log);
      if (!parsed || parsed.standard !== HAIRTO_STANDARD) continue;
      const items = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
      for (const data of items) events.push({ event: parsed.event, data } as ContractEvent);
    }
  }
  return events;
}

export function findEvent<K extends keyof HairtoEvents>(
  events: ContractEvent[],
  name: K,
): HairtoEvents[K] | null {
  const found = events.find((e) => e.event === name);
  return found ? (found.data as HairtoEvents[K]) : null;
}
