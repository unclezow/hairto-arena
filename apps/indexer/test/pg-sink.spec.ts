import pg from 'pg';
import { PgSink } from '../src/db/pg-sink.js';
import { PgStore } from '../src/db/pg-store.js';
import { decodeBlock } from '../src/decode.js';
import { block, CONTRACTS, duelCreated, hairto, outcome } from './fixtures.js';

const url = process.env.TEST_DATABASE_URL;
const SCHEMA = 'chain_sink_test';

describe.skipIf(!url)('PgSink on Postgres', () => {
  let pool: pg.Pool;
  let sink: PgSink;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    sink = new PgSink(pool, SCHEMA);
    await sink.migrate();
    // Running it twice is harmless: the indexer creates its schema at every start.
    await sink.migrate();
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.end();
  });

  it('writes a block and its cursor together, archiving events without a handler', async () => {
    const b = block(100, [
      outcome(CONTRACTS.arena, [duelCreated(1)], { id: 'R1', tx: 'T1' }),
      outcome(
        CONTRACTS.arena,
        [hairto('duel_rejected', { fighter: 'f.testnet', nonce: 1, reason: 'no' })],
        {
          id: 'R2',
        },
      ),
    ]);
    await sink.apply(100, decodeBlock(b, CONTRACTS));
    await expect(sink.cursor()).resolves.toBe(100);
    const { rows } = await pool.query(
      `SELECT event, receipt_id, tx_hash FROM ${SCHEMA}.raw_event ORDER BY log_index`,
    );
    expect(rows).toEqual([
      { event: 'duel_created', receipt_id: 'R1', tx_hash: 'T1' },
      { event: 'duel_rejected', receipt_id: 'R2', tx_hash: 'TxDefault' },
    ]);
    await expect(new PgStore(pool, SCHEMA).find('duel', { id: 1n })).resolves.toMatchObject({
      fighter: 'fighter.testnet',
      status: 'created',
    });
  });

  it('keeps nothing of a block that fails mid-way, so the next run processes it again', async () => {
    const good = block(102, [outcome(CONTRACTS.arena, [duelCreated(2)])]);
    const events = decodeBlock(good, CONTRACTS);
    // A second event whose handler throws, as if the process died while writing block 102.
    const broken = { ...events[0]!, position: { logIndex: 1 }, data: { duel_id: 'not a number' } };
    await expect(sink.apply(102, [...events, broken])).rejects.toThrow();
    await expect(sink.cursor()).resolves.toBe(100);
    await expect(new PgStore(pool, SCHEMA).find('duel', { id: 2n })).resolves.toBeNull();
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM ${SCHEMA}.raw_event WHERE block_height = 102`,
    );
    expect(rows[0]!.n).toBe(0);

    await sink.apply(102, events);
    await expect(sink.cursor()).resolves.toBe(102);
    await expect(new PgStore(pool, SCHEMA).find('duel', { id: 2n })).resolves.not.toBeNull();
  });

  it('stores the final head next to the cursor for the lag', async () => {
    await sink.noteHead(1_000);
    await sink.setCursor(980);
    const { rows } = await pool.query(
      `SELECT name, block_height::int AS h FROM ${SCHEMA}.indexer_cursor ORDER BY name`,
    );
    expect(rows).toEqual([
      { name: 'final_head', h: 1_000 },
      { name: 'main', h: 980 },
    ]);
  });
});
