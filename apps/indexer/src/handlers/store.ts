/**
 * Minimal storage interface the handlers write through. `PgStore` implements it on schema `chain` in production;
 * tests use an in-memory map. Rows are plain objects keyed by the table's primary key, with camelCase fields.
 */
export type TableName =
  | 'duel'
  | 'position'
  | 'duelTx'
  | 'openPosition'
  | 'fighterScore'
  | 'vaultEvent'
  | 'harvest'
  | 'pick'
  | 'season'
  | 'claim'
  | 'globalStat'
  | 'character'
  | 'characterBalance'
  | 'characterEquipped'
  | 'characterEquipEvent'
  | 'characterPurchase';

export type Row = Record<string, unknown>;
export type Key = Record<string, unknown>;

export interface Store {
  find(table: TableName, key: Key): Promise<Row | null>;
  /** Inserts `{ ...key, ...create }`, or merges `update(existing)` into the existing row. */
  upsert(table: TableName, key: Key, create: Row, update?: (existing: Row) => Row): Promise<void>;
  delete(table: TableName, key: Key): Promise<void>;
}

/** Where an event happened. `logIndex` grows within a block across all accepted events. */
export interface EventMeta {
  block: { height: bigint; timestampMs: bigint };
  position: { logIndex: number };
  receiptId: string;
  /** Base58 hash of the transaction the receipt belongs to, when the block data has it. */
  txHash: string | null;
  /** Contract that emitted the event. */
  executor: string;
}

export type IndexedEvent<Data> = EventMeta & { data: Data };

/** Position of the event that writes a row, used as the API sync cursor. */
export function writePosition(ev: EventMeta) {
  return { blockHeight: ev.block.height, logIndex: ev.position.logIndex };
}

/** Stable id of one event: unique across blocks, the same every time the block is processed. */
export function eventId(ev: EventMeta): string {
  return `${ev.receiptId}-${ev.position.logIndex}`;
}

/** Transaction hash for explorer links; falls back to the receipt id when the block data has no hash. */
export function txOf(ev: EventMeta): string {
  return ev.txHash ?? ev.receiptId;
}
