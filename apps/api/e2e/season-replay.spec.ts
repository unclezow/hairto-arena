import { ConfigService } from '@nestjs/config';
import pg from 'pg';
import { PgSink } from '../../indexer/src/db/pg-sink.js';
import { Ingest } from '../../indexer/src/ingest.js';
import type { NeardataClient } from '../../indexer/src/neardata/client.js';
import type { NeardataBlock, ReceiptExecutionOutcome } from '../../indexer/src/neardata/types.js';
import { CONTRACTS, hairto, outcome } from '../../indexer/test/fixtures.js';
import { validateEnv } from '../src/config/env.js';
import { ParamsService } from '../src/config/params.service.js';
import { FightersService } from '../src/fighters/fighters.service.js';
import { IndexerSyncService } from '../src/indexer-sync/indexer-sync.service.js';
import { LeaderboardService } from '../src/leaderboard/leaderboard.service.js';
import { MeService } from '../src/me/me.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { BalanceService } from '../src/read-model/balance.service.js';
import { FreshnessService } from '../src/read-model/freshness.service.js';
import { ScoreboardService } from '../src/read-model/scoreboard.service.js';
import { SeasonLookup } from '../src/read-model/season-lookup.service.js';
import { WalletStatusService } from '../src/read-model/wallet-status.service.js';
import { PotService } from '../src/seasons/pot.service.js';
import { MemoryRedis } from '../test/helpers/memory-redis.js';

/**
 * A whole season through every layer: Neardata blocks into the indexer (schema `chain`), `indexer-sync` into the
 * read model, then the API views. Runs when `TEST_E2E_DATABASE_URL` points at a throwaway Postgres whose public
 * schema has the Prisma tables (`prisma db push`); the indexer creates schema `chain` itself.
 */
const url = process.env.TEST_E2E_DATABASE_URL;

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Math.floor(Date.now() / 1000) * 1000;
const ALICE = 'alice.testnet';
const BOB = 'bob.testnet';
const CAROL = 'carol.testnet';
const ROOKIE = 'rookie.bots.hairto.testnet';
const ORACLE = 'oracle.bots.hairto.testnet';
const usdc = (n: number) => String(n * 1_000_000);
const root = Buffer.alloc(32, 7).toString('base64');

/** The recorded chain: one block per entry, in height order. */
class Recording {
  private height = 1_000;
  readonly blocks: NeardataBlock[] = [];

  add(atMs: number, ...outcomes: ReceiptExecutionOutcome[]) {
    this.height += 1 + (this.blocks.length % 3); // with skipped heights in between
    this.blocks.push({
      block: { header: { height: this.height, timestamp_nanosec: `${BigInt(atMs) * 1_000_000n}` } },
      shards: [{ shard_id: 0, receipt_execution_outcomes: outcomes }],
    });
  }

  arena(atMs: number, tx: string, ...logs: string[]) {
    this.add(atMs, outcome(CONTRACTS.arena, logs, { id: `R-${tx}`, tx }));
  }

  vault(atMs: number, tx: string, ...logs: string[]) {
    this.add(atMs, outcome(CONTRACTS.vault, logs, { id: `RV-${tx}`, tx }));
  }
}

let duelId = 0;

/** A duel the Fighter wins or loses on points, with its score. */
function duel(rec: Recording, atMs: number, fighter: string, win: boolean, level: 1 | 4) {
  const id = ++duelId;
  const bot = level === 4 ? ORACLE : ROOKIE;
  const points = win ? 25 : -10;
  rec.arena(
    atMs,
    `Start${id}`,
    hairto('duel_created', {
      duel_id: id,
      fighter,
      bot,
      bot_level: level,
      asset_id: 2,
      season: 1,
      nonce: id,
      start_ms: atMs + 5_000,
      damage_config_id: 1,
    }),
  );
  rec.arena(
    atMs + 10_000,
    `Open${id}`,
    hairto('position_opened', { duel_id: id, side: 'Fighter', player: fighter, open_tick: 2 }),
  );
  rec.arena(
    atMs + 30_000,
    `Close${id}`,
    hairto('position_closed', {
      duel_id: id,
      side: 'Fighter',
      player: fighter,
      dir: 'Long',
      close_tick: 8,
      net_pnl_ppm: win ? 1_500 : -1_500,
      self_delta: win ? 0 : -150,
      opponent_delta: win ? -150 : 0,
      hp_fighter: win ? 1_000 : 850,
      hp_bot: win ? 850 : 1_000,
    }),
  );
  rec.arena(
    atMs + 45_000,
    `Settle${id}`,
    hairto('duel_finished', {
      duel_id: id,
      winner: win ? fighter : bot,
      outcome: win ? 'Win' : 'Loss',
      ko: false,
      hp_fighter: win ? 1_000 : 850,
      hp_bot: win ? 850 : 1_000,
    }),
    hairto('result_recorded', {
      season: 1,
      fighter,
      duel_id: id,
      outcome: win ? 'Win' : 'Loss',
      points,
    }),
  );
}

function season(rec: Recording) {
  const s1 = { start: NOW - 10 * DAY, pickEnd: NOW - 9 * DAY, end: NOW - 3 * DAY };
  rec.arena(
    s1.start,
    'Season1',
    hairto('season_started', {
      season: 1,
      start_ms: s1.start,
      pick_end_ms: s1.pickEnd,
      end_ms: s1.end,
      asset_ids: [2],
    }),
  );
  rec.vault(
    s1.start + HOUR,
    'DepA',
    hairto('vault_deposited', {
      account_id: ALICE,
      pool: 'Fighter',
      amount: usdc(50),
      principal: usdc(50),
    }),
  );
  rec.vault(
    s1.start + HOUR,
    'DepB',
    hairto('vault_deposited', {
      account_id: BOB,
      pool: 'Fighter',
      amount: usdc(20),
      principal: usdc(20),
    }),
  );

  // Ten duels each, the minimum to rank; wins first so no total ever touches the floor.
  let at = s1.pickEnd + HOUR;
  for (let i = 0; i < 10; i++, at += HOUR) duel(rec, at, ALICE, i < 7, i % 2 === 0 ? 1 : 4);
  for (let i = 0; i < 10; i++, at += HOUR) duel(rec, at, BOB, i < 3, 1);

  rec.arena(
    s1.end + HOUR,
    'Close1',
    hairto('season_closed', { season: 1, closed_ms: s1.end + HOUR }),
  );
  rec.arena(
    s1.end + 2 * HOUR,
    'Results1',
    hairto('results_posted', {
      season: 1,
      prize_root: root,
      bonus_root: root,
      prize_total: usdc(30),
      bonus_total: usdc(10),
      claim_opens_ms: NOW - 2 * DAY,
    }),
  );
  rec.arena(
    NOW - DAY,
    'Claim1',
    hairto('prize_claimed', { season: 1, account_id: ALICE, amount: usdc(20) }),
  );

  // Season 2 is running: a Backer deposits, picks Alice, and the first harvest funds the pot.
  const s2 = { start: NOW - HOUR, pickEnd: NOW + DAY, end: NOW + 6 * DAY };
  rec.arena(
    s2.start,
    'Season2',
    hairto('season_started', {
      season: 2,
      start_ms: s2.start,
      pick_end_ms: s2.pickEnd,
      end_ms: s2.end,
      asset_ids: [2],
    }),
  );
  rec.vault(
    NOW - 50 * 60_000,
    'DepC',
    hairto('vault_deposited', {
      account_id: CAROL,
      pool: 'Backer',
      amount: usdc(500),
      principal: usdc(500),
    }),
  );
  rec.arena(
    NOW - 40 * 60_000,
    'Pick',
    hairto('picked', { season: 2, backer: CAROL, fighter: ALICE, backer_count: 1 }),
  );
  rec.vault(
    NOW - 30 * 60_000,
    'Harvest',
    hairto('vault_harvested', {
      fighter: { fee: '50000', pot: '950000', owners: '0' },
      backer: { fee: '100000', pot: '450000', owners: '450000' },
      fee: '150000',
      pot: '1400000',
    }),
  );
  rec.arena(
    NOW - 30 * 60_000 + 2_000,
    'Harvest',
    hairto('pot_funded', { season: 2, amount: '1400000', pot: '1400000' }),
  );
}

describe.skipIf(!url)('a season replayed through indexer, sync and API', () => {
  let pool: pg.Pool;
  let prisma: PrismaService;
  const redis = new MemoryRedis();

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await pool.query('DROP SCHEMA IF EXISTS chain CASCADE');
    const config = new ConfigService(validateEnv({ DATABASE_URL: url! }));
    prisma = new PrismaService(config as never);
    await prisma.$executeRawUnsafe(
      'TRUNCATE positions, duel_txs, bot_seeds, duels, bots, fighter_season_scores, picks, claims, deposits, harvests, fighters, backers, seasons, season_results, sync_cursors CASCADE',
    );

    // 1. Indexer: the recorded blocks, read through the ingest loop into schema `chain`.
    const rec = new Recording();
    season(rec);
    const byHeight = new Map(rec.blocks.map((b) => [b.block.header.height, b]));
    const head = rec.blocks.at(-1)!.block.header.height;
    const neardata = {
      finalHead: async () => head,
      block: async (h: number) => byHeight.get(h) ?? null,
    } as unknown as NeardataClient;
    const sink = new PgSink(pool);
    await sink.migrate();
    const ingest = new Ingest({
      neardata,
      sink,
      contracts: CONTRACTS,
      startBlock: 1_000,
      clock: { now: () => 0, sleep: async () => undefined },
    });
    while ((await ingest.step()) !== 'waiting');

    // 2. indexer-sync: schema `chain` into the read model, until a run copies nothing.
    const sync = new IndexerSyncService(prisma, redis.service, config as never);
    for (let i = 0; i < 10; i++) {
      const report = await sync.runOnce();
      expect(report.stalled).toEqual([]);
      if (Object.values(report.copied).every((n) => n === 0)) break;
    }
    expect((await sync.runOnce()).lag).toBe(0n);
  }, 60_000);

  afterAll(async () => {
    await pool?.query('DROP SCHEMA IF EXISTS chain CASCADE');
    await pool?.end();
    await prisma?.$disconnect();
  });

  const services = () => {
    const params = new ParamsService();
    const config = new ConfigService(validateEnv({ DATABASE_URL: url! }));
    const seasons = new SeasonLookup(prisma, params);
    const freshness = new FreshnessService(prisma);
    const scoreboard = new ScoreboardService(prisma);
    const balances = new BalanceService(prisma);
    const wallets = new WalletStatusService(prisma, params, seasons, balances);
    const pot = new PotService(prisma, params, balances, config as never);
    const offline = { claimableYieldOf: async () => Promise.reject(new Error('no node')) };
    return {
      leaderboard: new LeaderboardService(scoreboard, seasons, params, redis.service, freshness),
      fighters: new FightersService(prisma, seasons, freshness),
      me: new MeService(
        prisma,
        params,
        wallets,
        balances,
        scoreboard,
        seasons,
        pot,
        offline as never,
        {} as never,
        {} as never,
      ),
    };
  };

  it('ranks the season-1 leaderboard from the signed points', async () => {
    const board = (await services().leaderboard.get('1', 10, undefined)) as {
      items: { address: string; rank: number; points: number; duels: number; wins: number }[];
      indexedAtBlock: string | null;
    };
    expect(board.items.map((r) => [r.rank, r.address, r.points, r.duels, r.wins])).toEqual([
      [1, ALICE, 7 * 25 - 3 * 10, 10, 7],
      [2, BOB, 3 * 25 - 7 * 10, 10, 3],
    ]);
    expect(board.indexedAtBlock).not.toBeNull();
  });

  it("shows a Fighter's profile and history, level-4 duels included", async () => {
    const { fighters } = services();
    await expect(fighters.profile(ALICE)).resolves.toMatchObject({
      address: ALICE,
      totals: { points: 145, duels: 10, wins: 7 },
      backerCount: 1,
    });
    const history = await fighters.history(ALICE, 20, undefined);
    expect(history.items).toHaveLength(10);
    expect(history.items.map((d) => d.outcome)).toEqual([
      ...Array<string>(3).fill('loss'),
      ...Array<string>(7).fill('win'),
    ]);
    expect(new Set(history.items.map((d) => d.botLevel))).toEqual(new Set([1, 4]));
    expect(history.items.every((d) => d.status === 'FINISHED' && d.endAt !== null)).toBe(true);
  });

  it("shows the Backer's principal, pick and share of the harvest in the running season", async () => {
    const view = await services().me.backer(CAROL, false);
    expect(view).toMatchObject({
      accountId: CAROL,
      principal: 500_000_000n,
      source: 'database',
      claimableYield: null,
      pick: { fighter: ALICE },
      canPick: false,
      canPickReason: 'ALREADY_PICKED',
      season: { id: 2 },
    });
    expect(view.potContribution.value).toBe(450_000n);
  });

  it('keeps the posted results and the prize claim of season 1', async () => {
    const s1 = await prisma.season.findUnique({ where: { id: 1 } });
    expect(s1).toMatchObject({
      phase: 'results_posted',
      prizeRoot: '07'.repeat(32),
      resultsPostedAt: new Date(NOW - 3 * DAY + 2 * HOUR),
    });
    expect(String(s1!.prizeTotal)).toBe(usdc(30));
    await expect(prisma.season.findUnique({ where: { id: 2 } })).resolves.toMatchObject({
      phase: 'active',
    });
    await expect(prisma.claim.findMany()).resolves.toMatchObject([
      { seasonId: 1, address: ALICE, kind: 'PRIZE', amount: expect.anything() },
    ]);
  });
});
