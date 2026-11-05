import { beforeEach, describe, expect, it } from 'vitest';
import * as h from './index.js';
import { MemoryStore } from './memory-store.js';

const FIGHTER = 'fighter.testnet';
const BOT = 'trend.bots.hairto.testnet';
const BACKER = 'backer.testnet';
const TX = '9ZD8dx4hVQq7SSEbvMw3Fgo6tU9ALBuNoXTzVGqAyLhP';

let height = 100n;
let logIndex = 0;
/** An event in a new block, so every write position is distinct. */
const ev = <D>(
  data: D,
  over: { timestampMs?: bigint; txHash?: string; receiptId?: string; executor?: string } = {},
) => {
  height += 1n;
  logIndex += 1;
  return {
    data,
    block: { height, timestampMs: over.timestampMs ?? 1_000_000n + height },
    position: { logIndex },
    receiptId: over.receiptId ?? `R${height}`,
    txHash: over.txHash ?? TX,
    executor: over.executor ?? 'arena.hairto.testnet',
  };
};

const created = (duelId = 1) =>
  ev({
    duel_id: duelId,
    fighter: FIGHTER,
    bot: BOT,
    bot_level: 2,
    asset_id: 7,
    season: 1,
    nonce: 0,
    start_ms: 2_000_000,
    damage_config_id: 1,
  });

const closed = (player: string, dir: 'Long' | 'Short', pnl: number, opponentDelta: number) => ({
  duel_id: 1,
  side: (player === BOT ? 'Bot' : 'Fighter') as 'Bot' | 'Fighter',
  player,
  dir,
  close_tick: 20,
  net_pnl_ppm: pnl,
  self_delta: 0,
  opponent_delta: opponentDelta,
  hp_fighter: 1000,
  hp_bot: 1000 + opponentDelta,
  ko: false,
});

const opened = (player: string, tick: number, duelId = 1) =>
  ev({
    duel_id: duelId,
    side: player === BOT ? 'Bot' : 'Fighter',
    player,
    open_tick: tick,
  } as const);

describe('duel lifecycle handlers', () => {
  let store: MemoryStore;
  beforeEach(() => {
    store = new MemoryStore();
  });

  it('keeps the transaction hash and result of each duel step', async () => {
    const c = created();
    await h.onDuelCreated(c, store);
    const o = opened(FIGHTER, 10);
    await h.onPositionOpened({ ...o, txHash: 'OpenTx' }, store);
    const cl = ev(closed(FIGHTER, 'Long', 24, -96), { txHash: 'CloseTx' });
    await h.onPositionClosed(cl, store);
    expect(store.get('duelTx', { id: h.eventId(c) })).toMatchObject({
      kind: 'created',
      player: null,
      txHash: TX,
    });
    expect(store.get('duelTx', { id: h.eventId(o) })).toMatchObject({
      kind: 'opened',
      player: FIGHTER,
      txHash: 'OpenTx',
    });
    expect(store.get('duelTx', { id: h.eventId(cl) })).toMatchObject({
      kind: 'closed',
      txHash: 'CloseTx',
      dir: 1,
      pnlPpm: 24,
      opponentDelta: -96,
    });
  });

  it('duel_created writes a duel and counts it', async () => {
    await h.onDuelCreated(created(), store);
    expect(store.get('duel', { id: 1n })).toMatchObject({
      fighter: FIGHTER,
      bot: BOT,
      botLevel: 2,
      assetId: 7n,
      season: 1n,
      startMs: 2_000_000n,
      status: 'created',
    });
    expect(store.get('globalStat', { id: 'global' })).toMatchObject({ totalDuels: 1 });
  });

  it('does not count a duel twice when the event is processed again', async () => {
    const e = created();
    await h.onDuelCreated(e, store);
    await h.onDuelCreated(e, store);
    expect(store.get('globalStat', { id: 'global' })).toMatchObject({ totalDuels: 1 });
  });

  it('stores a position on open and fills its reveal on close, with the HP on the duel', async () => {
    await h.onDuelCreated(created(), store);
    await h.onPositionOpened(opened(FIGHTER, 12), store);
    const [open] = store.all('position');
    expect(open).toMatchObject({ duelId: 1n, player: FIGHTER, openTick: 12n });
    expect(open?.dir).toBeUndefined();

    await h.onPositionClosed(ev(closed(FIGHTER, 'Long', 400, -40)), store);
    expect(store.all('position')).toHaveLength(1);
    expect(store.all('position')[0]).toMatchObject({
      dir: 1,
      pnlPpm: 400,
      selfDelta: 0,
      opponentDelta: -40,
      closeTick: 20n,
      penalized: false,
      openTick: 12n,
    });
    expect(store.all('openPosition')).toHaveLength(0);
    expect(store.get('duel', { id: 1n })).toMatchObject({ hpFighter: 1000, hpBot: 960 });
  });

  it('keeps separate positions for fighter and bot and for repeated trades', async () => {
    await h.onDuelCreated(created(), store);
    await h.onPositionOpened(opened(FIGHTER, 1), store);
    await h.onPositionOpened(opened(BOT, 1), store);
    await h.onPositionClosed(ev(closed(FIGHTER, 'Long', 200, -20)), store);
    await h.onPositionOpened(opened(FIGHTER, 9), store);
    expect(store.all('position')).toHaveLength(3);
  });

  it('keeps a close whose open predates the start block', async () => {
    await h.onPositionClosed(ev({ ...closed(BOT, 'Short', 100, -10), duel_id: 9 }), store);
    expect(store.all('position')).toHaveLength(1);
  });

  it('fills an unrevealed position with the penalty and no direction', async () => {
    await h.onDuelCreated(created(), store);
    await h.onPositionOpened(opened(BOT, 3), store);
    await h.onPositionPenalized(
      ev({
        duel_id: 1,
        side: 'Bot',
        player: BOT,
        net_pnl_ppm: -300,
        self_delta: -30,
        opponent_delta: 0,
        hp_fighter: 1000,
        hp_bot: 970,
      } as const),
      store,
    );
    expect(store.all('position')[0]).toMatchObject({
      pnlPpm: -300,
      selfDelta: -30,
      penalized: true,
    });
    expect(store.all('position')[0]?.dir).toBeUndefined();
    expect(store.all('openPosition')).toHaveLength(0);
  });

  it('finishes a duel once with winner and KO flag, and counts it once', async () => {
    await h.onDuelCreated(created(), store);
    const fin = ev({
      duel_id: 1,
      winner: FIGHTER,
      outcome: 'Win',
      ko: true,
      hp_fighter: 820,
      hp_bot: 0,
    } as const);
    await h.onDuelFinished(fin, store);
    await h.onDuelFinished(fin, store);
    expect(store.get('duel', { id: 1n })).toMatchObject({
      status: 'finished',
      winner: FIGHTER,
      ko: true,
      hpBot: 0,
    });
    expect(store.get('globalStat', { id: 'global' })).toMatchObject({
      totalDuels: 1,
      finishedDuels: 1,
    });
  });

  it('a draw has no winner', async () => {
    await h.onDuelCreated(created(), store);
    await h.onDuelFinished(
      ev({
        duel_id: 1,
        winner: null,
        outcome: 'Draw',
        ko: false,
        hp_fighter: 1000,
        hp_bot: 1000,
      } as const),
      store,
    );
    expect(store.get('duel', { id: 1n })).toMatchObject({ status: 'finished', winner: null });
  });

  it('a forfeit makes the bot the winner', async () => {
    await h.onDuelCreated(created(), store);
    await h.onDuelForfeited(ev({ duel_id: 1, fighter: FIGHTER }), store);
    expect(store.get('duel', { id: 1n })).toMatchObject({ status: 'forfeited', winner: BOT });
    expect(store.get('globalStat', { id: 'global' })).toMatchObject({ forfeitedDuels: 1 });
  });

  it('void does not set a winner, and a late finish does not overwrite it', async () => {
    await h.onDuelCreated(created(), store);
    await h.onDuelVoided(ev({ duel_id: 1 }), store);
    await h.onDuelFinished(
      ev({
        duel_id: 1,
        winner: FIGHTER,
        outcome: 'Win',
        ko: false,
        hp_fighter: 1,
        hp_bot: 1,
      } as const),
      store,
    );
    const duel = store.get('duel', { id: 1n });
    expect(duel).toMatchObject({ status: 'voided' });
    expect(duel?.winner).toBeUndefined();
  });

  it('records the revealed bot seed as base64', async () => {
    await h.onDuelCreated(created(), store);
    const seed = Buffer.alloc(32, 0xab).toString('base64');
    await h.onBotSeedRevealed(ev({ duel_id: 1, seed, decisions_hash: null }), store);
    expect(store.get('duel', { id: 1n })).toMatchObject({ botSeed: seed });
  });

  it('ignores updates for duels created before the start block', async () => {
    await h.onDuelFinished(
      ev({
        duel_id: 99,
        winner: FIGHTER,
        outcome: 'Win',
        ko: false,
        hp_fighter: 1,
        hp_bot: 0,
      } as const),
      store,
    );
    expect(store.all('duel')).toHaveLength(0);
    expect(store.all('globalStat')).toHaveLength(0);
  });

  it('stamps every write with its block height and log index for the API cursor', async () => {
    const e = created();
    await h.onDuelCreated(e, store);
    expect(store.get('duel', { id: 1n })).toMatchObject({
      blockHeight: e.block.height,
      logIndex: e.position.logIndex,
    });
  });
});

describe('score handler', () => {
  let store: MemoryStore;
  beforeEach(async () => {
    store = new MemoryStore();
    await h.onDuelCreated(created(1), store);
    await h.onDuelCreated(created(2), store);
  });

  const result = (
    duelId: number,
    outcome: 'Win' | 'Loss' | 'Draw',
    points: number,
    timestampMs?: bigint,
  ) => ev({ season: 1, fighter: FIGHTER, duel_id: duelId, outcome, points }, { timestampMs });

  const score = () => store.get('fighterScore', { season: 1n, fighter: FIGHTER });

  it('accumulates points, duels and wins per season and fighter', async () => {
    await h.onResultRecorded(result(1, 'Win', 15, 5_000n), store);
    await h.onResultRecorded(result(2, 'Draw', 0, 6_000n), store);
    expect(score()).toMatchObject({ points: 15n, duels: 2, wins: 1 });
  });

  it('moves reachedAt only when the point total changes', async () => {
    await h.onResultRecorded(result(1, 'Win', 10, 5_000n), store);
    await h.onResultRecorded(result(2, 'Draw', 0, 6_000n), store);
    expect(score()?.reachedAt).toBe(5_000n);
  });

  it('deducts signed points and moves reachedAt when the score falls', async () => {
    await h.onResultRecorded(result(1, 'Win', 15, 5_000n), store);
    await h.onResultRecorded(result(2, 'Loss', -7, 6_000n), store);
    expect(score()).toMatchObject({ points: 8n, duels: 2, wins: 1, reachedAt: 6_000n });
    expect(store.get('duel', { id: 2n })).toMatchObject({
      outcome: 'Loss',
      pointsAwarded: -7n,
      counted: true,
    });
  });

  it('keeps the score at zero on an initial loss', async () => {
    await h.onResultRecorded(result(1, 'Loss', -7), store);
    expect(score()).toMatchObject({ points: 0n, duels: 1, reachedAt: 0n });
  });

  it('does not double count when the same result is processed twice', async () => {
    const e = result(1, 'Win', 10);
    await h.onResultRecorded(e, store);
    await h.onResultRecorded(e, store);
    expect(score()).toMatchObject({ points: 10n, duels: 1, wins: 1 });
  });
});

describe('vault, pick and season handlers', () => {
  let store: MemoryStore;
  beforeEach(() => {
    store = new MemoryStore();
  });

  it('records deposits, withdrawals and yield claims with their pool', async () => {
    await h.onDeposited(
      ev({
        account_id: FIGHTER,
        pool: 'Fighter',
        amount: '10000000',
        principal: '10000000',
      } as const),
      store,
    );
    await h.onWithdrawn(
      ev({ account_id: FIGHTER, pool: 'Fighter', amount: '1', principal: '9999999' } as const),
      store,
    );
    await h.onYieldClaimed(ev({ account_id: BACKER, amount: '2' }), store);
    const rows = store.all('vaultEvent');
    expect(rows.map((r) => [r.kind, r.pool])).toEqual([
      ['deposit', 'fighter'],
      ['withdraw', 'fighter'],
      ['claim_yield', 'backer'],
    ]);
    expect(rows[0]).toMatchObject({ account: FIGHTER, amount: 10_000_000n });
  });

  it('records a harvest per pool and attaches the season funded in the same transaction', async () => {
    await h.onHarvested(
      ev(
        {
          fighter: { fee: '5', pot: '95', owners: '0' },
          backer: { fee: '10', pot: '45', owners: '45' },
          fee: '15',
          pot: '140',
        },
        { executor: 'vault.hairto.testnet', txHash: 'HarvestTx' },
      ),
      store,
    );
    expect(store.get('harvest', { id: 'HarvestTx-fighter' })).toMatchObject({
      pool: 'fighter',
      season: null,
      grossYield: 100n,
      fee: 5n,
      toPot: 95n,
    });
    await h.onSeasonStarted(
      ev({ season: 2, start_ms: 1, pick_end_ms: 2, end_ms: 3, asset_ids: [1] }),
      store,
    );
    // The pot arrives three blocks later through ft_on_transfer, still in the harvest's transaction.
    await h.onPotFunded(
      ev({ season: 2, amount: '140', pot: '140' }, { txHash: 'HarvestTx' }),
      store,
    );
    expect(store.get('harvest', { id: 'HarvestTx-backer' })).toMatchObject({
      season: 2n,
      toOwners: 45n,
    });
    expect(store.get('season', { id: 2n })).toMatchObject({ pot: 140n });
  });

  it('skips a pool that accrued nothing', async () => {
    await h.onHarvested(
      ev({
        fighter: { fee: '0', pot: '0', owners: '0' },
        backer: { fee: '1', pot: '1', owners: '1' },
        fee: '1',
        pot: '1',
      }),
      store,
    );
    expect(store.all('harvest').map((r) => r.pool)).toEqual(['backer']);
  });

  it('records a pick per season and backer, and a later pick replaces it', async () => {
    await h.onPicked(ev({ season: 3, backer: BACKER, fighter: FIGHTER, backer_count: 1 }), store);
    await h.onPicked(
      ev({ season: 3, backer: BACKER, fighter: 'other.testnet', backer_count: 1 }),
      store,
    );
    expect(store.get('pick', { season: 3n, backer: BACKER })).toMatchObject({
      fighter: 'other.testnet',
    });
  });

  it('walks a season through start, close, results, rejection and rollover', async () => {
    await h.onSeasonStarted(
      ev({ season: 1, start_ms: 1_000, pick_end_ms: 1_500, end_ms: 2_000, asset_ids: [1, 2] }),
      store,
    );
    expect(store.get('season', { id: 1n })).toMatchObject({
      startMs: 1000n,
      endMs: 2000n,
      phase: 'active',
    });
    await h.onSeasonEndedEarly(ev({ season: 1, end_ms: 1_800 }), store);
    await h.onSeasonClosed(ev({ season: 1, closed_ms: 1_900 }), store);
    const prizeRoot = Buffer.alloc(32, 0xaa).toString('base64');
    const bonusRoot = Buffer.alloc(32, 0xbb).toString('base64');
    const posted = {
      season: 1,
      prize_root: prizeRoot,
      bonus_root: bonusRoot,
      prize_total: '70',
      bonus_total: '20',
      claim_opens_ms: 9_000,
    };
    await h.onResultsPosted(ev(posted, { timestampMs: 3_000n }), store);
    expect(store.get('season', { id: 1n })).toMatchObject({
      endMs: 1800n,
      phase: 'results_posted',
      prizeRoot: 'aa'.repeat(32),
      bonusRoot: 'bb'.repeat(32),
      prizeTotal: 70n,
      bonusTotal: 20n,
      resultsPostedAt: 3000n,
      claimOpensMs: 9000n,
    });

    await h.onResultsRejected(ev({ season: 1 }), store);
    expect(store.get('season', { id: 1n })).toMatchObject({ phase: 'closed', prizeRoot: null });

    await h.onResultsPosted(ev(posted, { timestampMs: 4_000n }), store);
    await h.onSeasonRolledOver(ev({ from_season: 1, to_season: 3, amount: '12' }), store);
    expect(store.get('season', { id: 1n })).toMatchObject({
      phase: 'rolled_over',
      rolledOverAmount: 12n,
    });
  });

  it('records prize and bonus claims', async () => {
    await h.onPrizeClaimed(ev({ season: 1, account_id: FIGHTER, amount: '9' }), store);
    await h.onBonusClaimed(ev({ season: 1, account_id: BACKER, amount: '3' }), store);
    expect(store.all('claim').map((c) => [c.kind, c.account, c.amount])).toEqual([
      ['prize', FIGHTER, 9n],
      ['bonus', BACKER, 3n],
    ]);
  });
});

describe('the full duel lifecycle of the chain-tables spec', () => {
  it('ends with the duel finished, both sides revealed and the signed points scored', async () => {
    const store = new MemoryStore();
    await h.onDuelCreated(ev({ ...created(7).data, duel_id: 7 }), store);
    await h.onPositionOpened(opened(FIGHTER, 3, 7), store);
    await h.onPositionOpened(opened(BOT, 4, 7), store);
    await h.onPositionClosed(ev({ ...closed(FIGHTER, 'Long', 300, -30), duel_id: 7 }), store);
    await h.onPositionClosed(ev({ ...closed(BOT, 'Short', -200, 0), duel_id: 7 }), store);
    await h.onDuelFinished(
      ev({
        duel_id: 7,
        winner: FIGHTER,
        outcome: 'Win',
        ko: false,
        hp_fighter: 1000,
        hp_bot: 950,
      } as const),
      store,
    );
    await h.onBotSeedRevealed(ev({ duel_id: 7, seed: 'c2VlZA==', decisions_hash: null }), store);
    await h.onResultRecorded(
      ev({ season: 1, fighter: FIGHTER, duel_id: 7, outcome: 'Win', points: 12 }),
      store,
    );
    expect(store.get('duel', { id: 7n })).toMatchObject({
      status: 'finished',
      winner: FIGHTER,
      ko: false,
      botSeed: 'c2VlZA==',
      outcome: 'Win',
      pointsAwarded: 12n,
    });
    expect(store.all('position').map((p) => [p.player, p.dir, p.pnlPpm])).toEqual([
      [FIGHTER, 1, 300],
      [BOT, 2, -200],
    ]);
    expect(store.get('fighterScore', { season: 1n, fighter: FIGHTER })).toMatchObject({
      points: 12n,
      wins: 1,
    });
  });
});
