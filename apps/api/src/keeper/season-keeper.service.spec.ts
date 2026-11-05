import { ConfigService } from '@nestjs/config';
import { validateEnv } from '../config/env.js';
import { ParamsService } from '../config/params.service.js';
import type { ResultInputs } from '../economics/results.js';
import { EMPTY_ROOT, verifyProof } from '../economics/merkle.js';
import type { ChainSeason, KeeperChain, PostedResults } from './keeper-chain.js';
import { SeasonKeeper } from './season-keeper.service.js';

const USDC = 1_000_000n;
const START = 1_800_000_000_000;
const END = START + 7 * 86_400_000;

function chainSeason(over: Partial<ChainSeason> = {}): ChainSeason {
  return {
    phase: 'Active',
    startMs: START,
    endMs: END,
    closeDelayMs: 15 * 60_000,
    claimPeriodMs: 30 * 86_400_000,
    resultsPostedMs: 0,
    claimOpensMs: 0,
    rolledOver: false,
    prizeRoot: EMPTY_ROOT,
    bonusRoot: EMPTY_ROOT,
    ...over,
  };
}

/** Ten duels for each of three Fighters, and one Backer picking the first. */
function inputs(): ResultInputs {
  const fighters = ['alice.testnet', 'bob.testnet', 'carol.testnet'];
  return {
    seasonId: 1,
    startMs: START,
    endMs: END,
    pot: 100n * USDC,
    fighterPotBps: 7_500,
    prizeCurveBps: [5_000, 3_000, 2_000],
    minDuels: 10,
    backerMinDeposit: 100n * USDC,
    scores: fighters.map((address, i) => ({
      address,
      points: 100 - i * 10,
      wins: 5,
      duels: 10,
      reachedAt: START + i,
    })),
    picks: [{ backer: 'dave.testnet', fighter: 'alice.testnet' }],
    balanceEvents: new Map([['dave.testnet', [{ at: START - 1_000, delta: 200n * USDC }]]]),
  };
}

function setup(state: {
  season: ChainSeason;
  now: number;
  chainTwab?: bigint;
  lag?: string | null;
}) {
  const sent: string[] = [];
  let posted: PostedResults | null = null;
  const runs = new Map<number, Record<string, unknown>>();
  const results: { address: string; amount: string; proof: string[] }[] = [];
  const chain: KeeperChain = {
    getSeason: async () => state.season,
    potOf: async () => 100n * USDC,
    twabOf: async () => state.chainTwab ?? 200n * USDC,
    now: async () => state.now,
    vaultTotals: async () => ({}) as never,
    harvest: async () => 'TxH',
    flushPayouts: async () => 'TxF',
    closeSeason: async () => (sent.push('close_season'), 'TxC'),
    postResults: async (r) => {
      sent.push('post_results');
      posted = r;
      return 'TxP';
    },
    rolloverUnclaimed: async () => (sent.push('rollover_unclaimed'), 'TxR'),
  };
  const upsert = async ({
    where,
    create,
    update,
  }: {
    where: { seasonId: number };
    create: object;
    update: object;
  }) => {
    runs.set(where.seasonId, { ...(runs.get(where.seasonId) ?? create), ...update });
  };
  const prisma = {
    season: {
      findMany: async () => [{ id: 1 }],
      findUnique: async () => ({ id: 1, phase: 'closed' }),
      update: () => null,
    },
    seasonRun: {
      findUnique: async ({ where }: { where: { seasonId: number } }) =>
        runs.get(where.seasonId) ?? null,
      upsert,
    },
    seasonResult: {
      deleteMany: () => null,
      createMany: ({ data }: { data: typeof results }) =>
        results.splice(0, results.length, ...data),
    },
    $transaction: async (ops: unknown[]) => ops,
  };
  const redis = {
    client: {
      set: async () => 'OK',
      del: async () => 1,
      get: async () => (state.lag === undefined ? '0' : state.lag),
    },
  };
  const config = new ConfigService(validateEnv({})) as never;
  const keeper = new SeasonKeeper(
    prisma as never,
    redis as never,
    new ParamsService(),
    config,
    { load: async () => inputs() } as never,
    { get: async () => 'live' } as never,
    { generate: async () => undefined } as never,
    chain,
  );
  return { keeper, sent, runs, results, posted: () => posted };
}

describe('SeasonKeeper', () => {
  it('closes the season once its end plus the close delay has passed', async () => {
    const early = setup({ season: chainSeason(), now: END + 60_000 });
    await expect(early.keeper.runOnce()).resolves.toEqual([{ seasonId: 1, action: 'idle' }]);
    const due = setup({ season: chainSeason(), now: END + 15 * 60_000 });
    await expect(due.keeper.runOnce()).resolves.toEqual([{ seasonId: 1, action: 'closed' }]);
    expect(due.sent).toEqual(['close_season']);
  });

  it('posts roots whose proofs verify for every computed amount', async () => {
    const s = setup({ season: chainSeason({ phase: 'Closed' }), now: END + 20 * 60_000 });
    await expect(s.keeper.runOnce()).resolves.toEqual([{ seasonId: 1, action: 'posted' }]);
    const posted = s.posted()!;
    expect(s.sent).toEqual(['post_results']);
    expect(posted.prizeTotal).toBeGreaterThan(0n);
    expect(posted.bonusTotal).toBeGreaterThan(0n);
    for (const r of s.results) {
      const root = r.address === 'dave.testnet' ? posted.bonusRoot : posted.prizeRoot;
      expect(verifyProof(root, r.address, BigInt(r.amount), r.proof)).toBe(true);
    }
    expect(s.runs.get(1)).toMatchObject({ state: 'posted', postedTxHash: 'TxP' });
  });

  it('does not post while the indexer lags 25 blocks at season close, and says why', async () => {
    const s = setup({
      season: chainSeason({ phase: 'Closed' }),
      now: END + 20 * 60_000,
      lag: '25',
    });
    await expect(s.keeper.runOnce()).resolves.toEqual([
      { seasonId: 1, action: 'blocked:indexer-lag' },
    ]);
    expect(s.sent).toEqual([]);
    const unknown = setup({
      season: chainSeason({ phase: 'Closed' }),
      now: END + 20 * 60_000,
      lag: null,
    });
    await expect(unknown.keeper.runOnce()).resolves.toEqual([
      { seasonId: 1, action: 'blocked:indexer-unknown' },
    ]);
  });

  it('refuses to post when an indexed TWAB differs from vault.twab_of beyond the tolerance', async () => {
    const s = setup({
      season: chainSeason({ phase: 'Closed' }),
      now: END + 20 * 60_000,
      chainTwab: 150n * USDC,
    });
    await expect(s.keeper.runOnce()).resolves.toEqual([
      { seasonId: 1, action: 'blocked:twab-mismatch' },
    ]);
    expect(s.sent).toEqual([]);
    expect(String(s.runs.get(1)?.error)).toContain('TWAB of dave.testnet');
  });

  it('rolls a finalized season over once its claim period ended', async () => {
    const opens = END + 2 * 3_600_000;
    const season = chainSeason({
      phase: 'Finalized',
      resultsPostedMs: END + 3_600_000,
      claimOpensMs: opens,
    });
    const s = setup({ season, now: opens + 30 * 86_400_000 });
    await expect(s.keeper.runOnce()).resolves.toEqual([{ seasonId: 1, action: 'rolled-over' }]);
    season.rolledOver = true;
    await expect(s.keeper.runOnce()).resolves.toEqual([{ seasonId: 1, action: 'rolled-over' }]);
    expect(s.sent).toEqual(['rollover_unclaimed']);
  });
});
