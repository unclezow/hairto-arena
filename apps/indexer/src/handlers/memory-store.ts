import type { Key, Row, Store, TableName } from './store.js';

const keyOf = (table: TableName, key: Key) =>
  `${table}:${JSON.stringify(
    Object.entries(key).sort(([a], [b]) => a.localeCompare(b)),
    (_k, v) => (typeof v === 'bigint' ? `${v}n` : v),
  )}`;

/** In-memory Store for tests. */
export class MemoryStore implements Store {
  readonly rows = new Map<string, Row>();

  async find(table: TableName, key: Key) {
    const row = this.rows.get(keyOf(table, key));
    return row ? { ...row } : null;
  }

  async upsert(table: TableName, key: Key, create: Row, update?: (existing: Row) => Row) {
    const k = keyOf(table, key);
    const existing = this.rows.get(k);
    if (!existing) this.rows.set(k, { ...key, ...create });
    else if (update) this.rows.set(k, { ...existing, ...update(existing) });
  }

  async delete(table: TableName, key: Key) {
    this.rows.delete(keyOf(table, key));
  }

  get(table: TableName, key: Key) {
    return this.rows.get(keyOf(table, key));
  }

  all(table: TableName) {
    return [...this.rows.entries()]
      .filter(([k]) => k.startsWith(`${table}:`))
      .map(([, row]) => row);
  }
}
