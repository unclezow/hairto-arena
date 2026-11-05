import { Dir } from '@hairto-arena/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { BotDuelRunner, type RunnerInit } from '../src/bot/bot-duel-runner.js';
import { defaultBotConfig } from '../src/bot/bot-config.js';
import { positionCommit, positionSalt } from '../src/bot/position-commit.js';
import { hashSeed } from '../src/bot/seed.js';
import {
  BOT_ACCOUNT,
  climbingTick,
  FakeBotGateway,
  ManualTicks,
  MemoryRunnerState,
} from './helpers/fake-bot-gateway.js';

const seed = 'ab'.repeat(32);
const fighter = 'fighter.testnet';

describe('BotDuelRunner', () => {
  let gateway: FakeBotGateway;
  let ticks: ManualTicks;
  let state: MemoryRunnerState;
  let init: RunnerInit;
  let duelId: bigint;
  let done: bigint[];

  beforeEach(async () => {
    gateway = new FakeBotGateway();
    ticks = new ManualTicks();
    state = new MemoryRunnerState();
    done = [];
    duelId = gateway.startDuel({
      level: 2,
      fighter,
      assetId: 1,
      seedHash: hashSeed(seed, fighter, 0),
    });
    init = {
      duelId,
      level: 2,
      assetId: 1,
      botAccount: BOT_ACCOUNT[2],
      seed,
      config: defaultBotConfig(2),
      startMs: 1_000_000,
    };
  });

  const runner = (over: Partial<RunnerInit> = {}) =>
    new BotDuelRunner(
      { ...init, ...over },
      { gateway, ticks, state, onDone: (id) => done.push(id) },
    );

  /** Plays seconds [from, to) of the climbing price through the runner. */
  async function play(r: BotDuelRunner, from: number, to: number) {
    for (let s = from; s < to; s++) {
      gateway.currentTick = s + 1;
      await r.handleTick(climbingTick(s));
    }
  }

  it('plays a whole duel: commits when opening and reveals a matching direction when closing', async () => {
    const r = runner();
    await r.start();
    await play(r, 0, 34);

    // The fake chain rejects a close whose (dir, salt) does not hash to the commit, so reaching here proves it.
    expect(gateway.count('openPosition')).toBeGreaterThan(0);
    expect(gateway.count('closePosition')).toBe(gateway.count('openPosition'));
    expect((await gateway.getPosition(duelId, 'Bot'))?.open).toBe(false);
  });

  it('closes any open position before the round ends', async () => {
    const r = runner();
    await r.start();
    // Stop right after the forced close window starts.
    await play(r, 0, 28);
    expect((await gateway.getPosition(duelId, 'Bot'))?.open).toBe(false);
  });

  it('never exceeds the maximum number of trades', async () => {
    const r = runner({ config: { ...defaultBotConfig(2), maxTrades: 1 } });
    await r.start();
    await play(r, 0, 34);
    expect(gateway.count('openPosition')).toBeLessThanOrEqual(1);
  });

  it('does not open while the oracle is unhealthy, then trades once it recovers', async () => {
    ticks.oracleHealthy = false;
    const r = runner();
    await r.start();
    await play(r, 0, 14);
    expect(gateway.count('openPosition')).toBe(0);

    ticks.oracleHealthy = true;
    await play(r, 14, 20);
    expect(gateway.count('openPosition')).toBeGreaterThan(0);
  });

  it('ignores ticks before the round and finishes after it', async () => {
    const r = runner({ startMs: 1_005_000 });
    await r.start();
    await play(r, 0, 5);
    expect(gateway.calls.filter((c) => c.fn === 'openPosition')).toHaveLength(0);

    await play(r, 5, 45);
    expect(r.finished).toBe(true);
    expect(done).toEqual([duelId]);
    expect(ticks.subscribers).toBe(0);
  });

  it('uses the history it was started with, but only ticks up to the current one', async () => {
    ticks.past = Array.from({ length: 10 }, (_, s) => climbingTick(s));
    const r = runner();
    await r.start();
    // The trend is already visible, so it can act on the very first live tick.
    await play(r, 10, 11);
    expect(gateway.count('openPosition')).toBe(1);
  });

  describe('restart', () => {
    it('does not open a second position and closes the first with the right salt', async () => {
      const first = runner();
      await first.start();
      await play(first, 0, 12);
      const opened = gateway.count('openPosition');
      expect(opened).toBeGreaterThan(0);
      expect((await gateway.getPosition(duelId, 'Bot'))?.open).toBe(true);
      first.stop();

      const second = runner();
      await second.start();
      await play(second, 12, 34);

      expect(gateway.count('closePosition')).toBeGreaterThan(0);
      expect((await gateway.getPosition(duelId, 'Bot'))?.open).toBe(false);
      // A second open only happens after the first was closed, never on top of it.
      expect(gateway.count('openPosition')).toBeLessThanOrEqual(init.config.maxTrades);
    });

    it('finds its open position from the chain when the saved state is lost', async () => {
      const first = runner();
      await first.start();
      await play(first, 0, 12);
      first.stop();
      state.states.clear();

      const second = runner();
      await second.start();
      await play(second, 12, 34);
      expect((await gateway.getPosition(duelId, 'Bot'))?.open).toBe(false);
    });

    it('drops a saved open position the chain no longer has', async () => {
      await state.save(duelId, {
        tradesUsed: 1,
        open: { dir: Dir.Long, tradeIndex: 0, openedAt: 1_005_000 },
      });
      const r = runner();
      await r.start();
      expect((await state.load(duelId))!.open).toBeNull();
      // The trade still counts toward the maximum.
      expect((await state.load(duelId))!.tradesUsed).toBe(1);
    });

    it('resyncs instead of opening on top of a position it did not know about', async () => {
      const r = runner();
      await r.start();
      // Someone (a previous process) opened a Long with trade index 0 behind the runner's back.
      await gateway.openPosition(
        2,
        duelId,
        positionCommit(Dir.Long, positionSalt(seed, 0), duelId, BOT_ACCOUNT[2]),
      );
      const before = gateway.count('openPosition');
      await play(r, 0, 34);
      expect(gateway.count('openPosition')).toBeLessThanOrEqual(before + init.config.maxTrades - 1);
      expect((await gateway.getPosition(duelId, 'Bot'))?.open).toBe(false);
    });
  });

  describe('failures', () => {
    it('keeps its state when an open transaction fails and decides again on the next tick', async () => {
      const r = runner();
      await r.start();
      gateway.failNext.set('openPosition', new Error('rpc down'));
      await play(r, 0, 20);
      // The first attempt failed, a later tick succeeded; nothing was double counted.
      expect(gateway.count('openPosition')).toBeGreaterThanOrEqual(2);
      const saved = await state.load(duelId);
      expect(saved!.tradesUsed).toBeLessThanOrEqual(init.config.maxTrades);
    });

    it('retries a failed close on the next tick', async () => {
      const r = runner();
      await r.start();
      await play(r, 0, 12);
      gateway.failNext.set('closePosition', new Error('rpc down'));
      await play(r, 12, 34);
      expect((await gateway.getPosition(duelId, 'Bot'))?.open).toBe(false);
    });
  });
});
