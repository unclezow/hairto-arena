import type { Key, Row, Store, TableName } from '../handlers/store.js';
import { snake, TABLES, type Column } from './tables.js';

/** Anything that runs a parameterized query: a `pg` Pool, or the client of an open transaction. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

const quote = (name: string) => `"${name}"`;

function toDb(col: Column | undefined, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (col?.type === 'bigint' || col?.type === 'numeric') return (value as bigint).toString();
  if (col?.type === 'jsonb') return JSON.stringify(value);
  return value;
}

function fromDb(col: Column, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (col.type === 'bigint' || col.type === 'numeric') return BigInt(value as string);
  return value;
}

/**
 * `Store` on schema `chain`. Every call of one block goes through the same transaction client, so a block's writes
 * and its cursor update commit together. Rows come back with camelCase fields and bigint numbers, exactly as the
 * handlers wrote them.
 */
export class PgStore implements Store {
  constructor(
    private readonly db: Queryable,
    private readonly schema = 'chain',
  ) {}

  private table(table: TableName) {
    return `${this.schema}.${quote(TABLES[table].sql)}`;
  }

  private where(table: TableName, key: Key, offset = 0) {
    const spec = TABLES[table];
    const names = Object.keys(key);
    return {
      sql: names.map((n, i) => `${quote(snake(n))} = $${i + 1 + offset}`).join(' AND '),
      values: names.map((n) => toDb(spec.columns[n], key[n])),
    };
  }

  private read(table: TableName, raw: Record<string, unknown>): Row {
    const row: Row = {};
    for (const [name, col] of Object.entries(TABLES[table].columns)) {
      row[name] = fromDb(col, raw[snake(name)]);
    }
    return row;
  }

  async find(table: TableName, key: Key): Promise<Row | null> {
    const where = this.where(table, key);
    const { rows } = await this.db.query(
      `SELECT * FROM ${this.table(table)} WHERE ${where.sql}`,
      where.values,
    );
    return rows[0] ? this.read(table, rows[0]) : null;
  }

  async upsert(table: TableName, key: Key, create: Row, update?: (existing: Row) => Row) {
    const spec = TABLES[table];
    const existing = await this.find(table, key);
    if (!existing) {
      const row = { ...key, ...create };
      const names = Object.keys(row).filter((n) => n in spec.columns);
      const columns = names.map((n) => quote(snake(n))).join(', ');
      const params = names.map((_, i) => `$${i + 1}`).join(', ');
      await this.db.query(
        `INSERT INTO ${this.table(table)} (${columns}) VALUES (${params})`,
        names.map((n) => toDb(spec.columns[n], row[n])),
      );
      return;
    }
    if (!update) return;
    const patch = update(existing);
    const names = Object.keys(patch).filter((n) => n in spec.columns && !(n in key));
    if (names.length === 0) return;
    const sets = names.map((n, i) => `${quote(snake(n))} = $${i + 1}`).join(', ');
    const where = this.where(table, key, names.length);
    await this.db.query(`UPDATE ${this.table(table)} SET ${sets} WHERE ${where.sql}`, [
      ...names.map((n) => toDb(spec.columns[n], patch[n])),
      ...where.values,
    ]);
  }

  async delete(table: TableName, key: Key) {
    const where = this.where(table, key);
    await this.db.query(`DELETE FROM ${this.table(table)} WHERE ${where.sql}`, where.values);
  }
}
