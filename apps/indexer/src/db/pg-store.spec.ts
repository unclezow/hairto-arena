import pg from 'pg';
import * as h from '../handlers/index.js';
import { MemoryStore } from '../handlers/memory-store.js';
import type { Store, TableName } from '../handlers/store.js';
import { PgStore } from './pg-store.js';
import { renderSchema, TABLES } from './tables.js';

/** Runs against a real Postgres when `TEST_DATABASE_URL` is set (a throwaway database: the schema is dropped). */
const url = process.env.TEST_DATABASE_URL;
const SCHEMA = 'chain_store_test';

let height = 1_000n;
let logIndex = 0;
const ev = <D>(data: D, txHash = 'T1') => {
  height += 1n;
  logIndex += 1;
  return {
    data,
    block: { height, timestampMs: 1_700_000_000_000n + height },
    position: { logIndex },
    receiptId: `R${height}`,
    txHash,
    executor: 'arena.hairto.testnet',
  };
};

/** A season, a duel played to the end and scored, a deposit, a harvest with its pot, and a character mint. */
async function scenario(store: Store) {
  await h.onSeasonStarted(
    ev({ season: 1, start_ms: 1, pick_end_ms: 2, end_ms: 3, asset_ids: [2] }),
    store,
  );
  await h.onDuelCreated(
    ev({
      duel_id: 7,
      fighter: 'fighter.testnet',
      bot: 'trend.bots.hairto.testnet',
      bot_level: 2,
      asset_id: 2,
      season: 1,
      nonce: 0,
      start_ms: 5_000,
      damage_config_id: 1,
    }),
    store,
  );
  await h.onPositionOpened(
    ev({ duel_id: 7, side: 'Fighter', player: 'fighter.testnet', open_tick: 3 } as const),
    store,
  );
  await h.onPositionClosed(
    ev({
      duel_id: 7,
      side: 'Fighter',
      player: 'fighter.testnet',
      dir: 'Short',
      close_tick: 9,
      net_pnl_ppm: 250,
      self_delta: 0,
      opponent_delta: -100,
      hp_fighter: 1000,
      hp_bot: 900,
      ko: false,
    } as const),
    store,
  );
  await h.onDuelFinished(
    ev({
      duel_id: 7,
      winner: 'fighter.testnet',
      outcome: 'Win',
      ko: false,
      hp_fighter: 1000,
      hp_bot: 900,
    } as const),
    store,
  );
  await h.onResultRecorded(
    ev({ season: 1, fighter: 'fighter.testnet', duel_id: 7, outcome: 'Win', points: 12 } as const),
    store,
  );
  await h.onDeposited(
    ev({
      account_id: 'b.testnet',
      pool: 'Backer',
      amount: '100000000',
      principal: '100000000',
    } as const),
    store,
  );
  await h.onHarvested(
    ev(
      {
        fighter: { fee: '1', pot: '9', owners: '0' },
        backer: { fee: '2', pot: '9', owners: '9' },
        fee: '3',
        pot: '18',
      },
      'H1',
    ),
    store,
  );
  await h.onPotFunded(ev({ season: 1, amount: '18', pot: '18' }, 'H1'), store);
  await h.onCharacterListed(
    ev({ token_id: '2', name: 'Knight', price: '5000000', max_supply: 0 }),
    store,
  );
  await h.onMtMint(ev([{ owner_id: 'b.testnet', token_ids: ['2'], amounts: ['1'] }]), store);
}

describe.skipIf(!url)('PgStore on Postgres', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(renderSchema(SCHEMA));
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.end();
  });

  it('writes exactly the rows the in-memory store holds after the same events', async () => {
    const memory = new MemoryStore();
    const startHeight = height;
    const startLog = logIndex;
    await scenario(memory);

    height = startHeight;
    logIndex = startLog;
    await scenario(new PgStore(pool, SCHEMA));

    const pgStore = new PgStore(pool, SCHEMA);
    for (const table of Object.keys(TABLES) as TableName[]) {
      for (const row of memory.all(table)) {
        const key = Object.fromEntries(TABLES[table].primaryKey.map((k) => [k, row[k]]));
        const stored = await pgStore.find(table, key);
        // Columns the handlers never wrote come back as null from Postgres.
        const expected = Object.fromEntries(
          Object.keys(TABLES[table].columns).map((k) => [k, row[k] ?? null]),
        );
        expect({ table, row: stored }).toEqual({ table, row: expected });
      }
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM ${SCHEMA}."${TABLES[table].sql}"`,
      );
      expect({ table, n: rows[0]!.n }).toEqual({ table, n: memory.all(table).length });
    }
  });

  it('leaves nothing behind when a block transaction is rolled back', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await h.onDuelVoided(ev({ duel_id: 7 }), new PgStore(client, SCHEMA));
      await h.onCharacterListed(
        ev({ token_id: '9', name: 'Ghost', price: '1', max_supply: 1 }),
        new PgStore(client, SCHEMA),
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const store = new PgStore(pool, SCHEMA);
    expect(await store.find('character', { id: 9n })).toBeNull();
    expect(await store.find('duel', { id: 7n })).toMatchObject({ status: 'finished' });
  });

  it('deletes rows by key', async () => {
    const store = new PgStore(pool, SCHEMA);
    await store.upsert(
      'openPosition',
      { id: 'x' },
      { positionId: 'p', blockHeight: 1n, logIndex: 0 },
    );
    await store.delete('openPosition', { id: 'x' });
    expect(await store.find('openPosition', { id: 'x' })).toBeNull();
  });
});
