import type pg from 'pg';
import type { DecodedEvent } from '../decode.js';
import { HANDLERS } from '../handlers/index.js';
import type { BlockSink, Logger } from '../ingest.js';
import { PgStore } from './pg-store.js';
import { renderSchema } from './tables.js';

/** Cursor rows: the last processed height, and the final head the indexer last saw (for the lag). */
export const CURSOR_MAIN = 'main';
export const CURSOR_FINAL_HEAD = 'final_head';

const json = (value: unknown) =>
  JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));

/**
 * Writes each block in one transaction: the raw archive, the handlers' rows, and the cursor. A crash mid-block
 * leaves nothing of that block, and the next run processes it again.
 */
export class PgSink implements BlockSink {
  private readonly unknown = new Set<string>();

  constructor(
    private readonly pool: pg.Pool,
    private readonly schema = 'chain',
    private readonly log?: Logger,
  ) {}

  /** Creates schema `chain` and its tables if they do not exist. */
  async migrate(): Promise<void> {
    await this.pool.query(renderSchema(this.schema));
  }

  async cursor(): Promise<number | null> {
    const { rows } = await this.pool.query<{ block_height: string }>(
      `SELECT block_height::text FROM ${this.schema}.indexer_cursor WHERE name = $1`,
      [CURSOR_MAIN],
    );
    return rows[0] ? Number(rows[0].block_height) : null;
  }

  private async write(db: pg.Pool | pg.PoolClient, name: string, height: number) {
    await db.query(
      `INSERT INTO ${this.schema}.indexer_cursor (name, block_height, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (name) DO UPDATE SET block_height = EXCLUDED.block_height, updated_at = now()`,
      [name, height],
    );
  }

  setCursor(height: number) {
    return this.write(this.pool, CURSOR_MAIN, height);
  }

  noteHead(height: number) {
    return this.write(this.pool, CURSOR_FINAL_HEAD, height);
  }

  async apply(height: number, events: DecodedEvent[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const store = new PgStore(client, this.schema);
      for (const ev of events) {
        await client.query(
          `INSERT INTO ${this.schema}.raw_event
             (block_height, log_index, block_timestamp_ms, receipt_id, tx_hash, executor, standard, version, event, data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (block_height, log_index) DO NOTHING`,
          [
            ev.block.height.toString(),
            ev.position.logIndex,
            ev.block.timestampMs.toString(),
            ev.receiptId,
            ev.txHash,
            ev.executor,
            ev.standard,
            ev.version,
            ev.event,
            json(ev.data),
          ],
        );
        const handler = HANDLERS[`${ev.standard}:${ev.event}`];
        if (handler && handler.from === ev.role) {
          await handler.handle(ev as never, store);
        } else if (!this.unknown.has(ev.event)) {
          this.unknown.add(ev.event);
          this.log?.info(
            `No handler for ${ev.standard}:${ev.event} from ${ev.role}; archived only`,
          );
        }
      }
      await this.write(client, CURSOR_MAIN, height);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
