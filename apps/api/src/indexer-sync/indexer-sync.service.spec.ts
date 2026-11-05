import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ConfigService } from '@nestjs/config';
import { validateEnv } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RedisService } from '../redis/redis.service.js';
import { IndexerSyncService } from './indexer-sync.service.js';

/**
 * Runs against a throwaway Postgres whose public schema has the Prisma tables (`prisma db push`) when
 * `TEST_READ_DATABASE_URL` is set. Schema `chain` is created from the indexer's own `sql/schema.sql`.
 */
const url = process.env.TEST_READ_DATABASE_URL;

/** The statements of the indexer's `sql/schema.sql`, comments dropped (they may contain semicolons). */
const schemaStatements = () =>
  readFileSync(fileURLToPath(new URL('../../../indexer/sql/schema.sql', import.meta.url)), 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

describe.skipIf(!url)('IndexerSyncService from schema chain', () => {
  let prisma: PrismaService;
  let sync: IndexerSyncService;
  const redisValues = new Map<string, string>();

  beforeAll(async () => {
    const config = new ConfigService(validateEnv({ DATABASE_URL: url! })) as never;
    prisma = new PrismaService(config);
    const redis = {
      client: {
        set: async (k: string, v: string) => void redisValues.set(k, v),
        incr: async () => 1,
        del: async () => 1,
      },
    } as unknown as RedisService;
    sync = new IndexerSyncService(prisma, redis, config);
    await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS chain CASCADE');
    for (const statement of schemaStatements()) {
      await prisma.$executeRawUnsafe(statement);
    }
    await prisma.$executeRawUnsafe(
      'TRUNCATE positions, duel_txs, bot_seeds, duels, bots, fighter_season_scores, picks, claims, deposits, harvests, fighters, backers, seasons, sync_cursors CASCADE',
    );
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS chain CASCADE');
    await prisma.$disconnect();
  });

  const sql = (statement: string) => prisma.$executeRawUnsafe(statement);

  it('copies a finished duel against level 4, its positions and score, then reports the lag', async () => {
    await sql(`INSERT INTO chain.season (id, start_ms, pick_end_ms, end_ms, phase, block_height, log_index)
      VALUES (1, 1800000000000, 1800086400000, 1800604800000, 'active', 100, 0)`);
    await sql(`INSERT INTO chain.duel (id, fighter, bot, bot_level, asset_id, season, nonce, start_ms, status, winner,
        ko, hp_fighter, hp_bot, created_at, finished_at, bot_seed, outcome, points_awarded, counted, block_height, log_index)
      VALUES (42, 'fighter.testnet', 'oracle.bots.hairto.testnet', 4, 2, 1, 0, 1800000005000, 'finished',
        'fighter.testnet', true, 1000, 0, 1800000000000, 1800000040000, 'c2VlZA==', 'Win', 25, true, 120, 3)`);
    await sql(`INSERT INTO chain.position (id, duel_id, player, dir, pnl_ppm, self_delta, opponent_delta, penalized,
        open_tick, close_tick, opened_at, closed_at, block_height, log_index)
      VALUES ('42-f', 42, 'fighter.testnet', 1, 2400, 0, -1000, false, 3, 9, 1800000006000, 1800000020000, 110, 1),
             ('42-b', 42, 'oracle.bots.hairto.testnet', 2, -300, -30, 0, false, 4, 8, 1800000007000, 1800000019000, 109, 0)`);
    await sql(`INSERT INTO chain.fighter_score (season, fighter, points, duels, wins, reached_at, block_height, log_index)
      VALUES (1, 'fighter.testnet', 25, 1, 1, 1800000045000, 130, 0)`);
    await sql(
      `INSERT INTO chain.indexer_cursor (name, block_height) VALUES ('main', 980), ('final_head', 1000)`,
    );

    const report = await sync.runOnce();
    expect(report.stalled).toEqual([]);
    expect(report.copied).toMatchObject({ season: 1, duel: 1, position: 2, fighter_score: 1 });

    const duel = await prisma.duel.findUnique({
      where: { id: 42n },
      include: { bot: true, positions: { orderBy: { openTick: 'asc' } } },
    });
    expect(duel).toMatchObject({
      status: 'FINISHED',
      winner: 'fighter.testnet',
      ko: true,
      pointsAwarded: 25,
      startAt: new Date(1_800_000_005_000),
      endAt: new Date(1_800_000_040_000),
    });
    expect(duel!.bot).toMatchObject({ level: 4, strategy: 'oracle' });
    expect(duel!.positions.map((p) => [p.player, p.isBot, p.dir])).toEqual([
      ['fighter.testnet', false, 'LONG'],
      ['oracle.bots.hairto.testnet', true, 'SHORT'],
    ]);
    await expect(
      prisma.fighterSeasonScore.findUnique({
        where: { seasonId_fighterAddress: { seasonId: 1, fighterAddress: 'fighter.testnet' } },
      }),
    ).resolves.toMatchObject({ points: 25, reachedAt: new Date(1_800_000_045_000) });

    expect(report.lag).toBe(20n);
    expect(redisValues.get('sync:lag')).toBe('20');
  });

  it('copies a vault deposit and a harvest per pool, and updates the funded season later', async () => {
    await sql(`INSERT INTO chain.vault_event (id, pool, account, kind, amount, timestamp, tx_hash, block_height, log_index)
      VALUES ('R1-0', 'backer', 'backer.testnet', 'deposit', 100000000, 1800000001000, 'DepTx', 140, 0)`);
    await sql(`INSERT INTO chain.harvest (id, pool, season, gross_yield, fee, to_pot, to_owners, timestamp, tx_hash, block_height, log_index)
      VALUES ('HTx-fighter', 'fighter', NULL, 100, 5, 95, 0, 1800000002000, 'HTx', 150, 2),
             ('HTx-backer', 'backer', NULL, 90, 9, 41, 40, 1800000002000, 'HTx', 150, 2)`);
    await sync.runOnce();
    const harvests = await prisma.harvest.findMany({ orderBy: { logIndex: 'asc' } });
    expect(harvests.map((h) => [h.vault, h.logIndex, h.seasonId])).toEqual([
      ['FIGHTER', 0, null],
      ['BACKER', 1, null],
    ]);
    await expect(prisma.deposit.findFirst()).resolves.toMatchObject({
      address: 'backer.testnet',
      vault: 'BACKER',
      action: 'DEPOSIT',
    });
    await expect(
      prisma.backer.findUnique({ where: { address: 'backer.testnet' } }),
    ).resolves.not.toBeNull();

    // pot_funded lands three blocks later and the indexer rewrites both rows with the season.
    await sql(`UPDATE chain.harvest SET season = 1, block_height = 153, log_index = 0`);
    await sync.runOnce();
    const after = await prisma.harvest.findMany();
    expect(after.map((h) => h.seasonId)).toEqual([1, 1]);
  });

  it('reports no indexer while schema chain does not exist', async () => {
    await sql('DROP SCHEMA chain CASCADE');
    await expect(sync.runOnce()).resolves.toMatchObject({ skipped: 'no-indexer' });
    await expect(sync.readLag()).rejects.toThrow();
    for (const statement of schemaStatements()) {
      await sql(statement);
    }
  });
});
