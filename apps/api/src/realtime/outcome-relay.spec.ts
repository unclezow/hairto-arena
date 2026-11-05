import { WS_EVENTS } from '@hairto-arena/shared';
import type { FinalExecutionOutcome } from 'near-kit';
import { MemoryRedis } from '../../test/helpers/memory-redis.js';
import { AppException } from '../common/errors.js';
import { DuelTxRelayService } from '../duels/duel-tx-relay.service.js';
import { onchainKey } from '../duels/onchain-steps.js';
import { ArenaClient } from '../near/arena.client.js';
import type { NearService } from '../near/near.service.js';
import { OutcomeEventSource } from './duel-chain-events.js';
import { DuelEventPublisher } from './duel-event-publisher.service.js';
import { DuelLiveStore } from './duel-live.js';
import { OutcomeRelay } from './outcome-relay.js';
import { OUTCOME_STREAM, OutcomeStream, relayedOutcome } from './outcome-stream.js';

const ARENA = 'arena.hairto.testnet';
const FIGHTER = 'fighter.testnet';
const BOT = 'rookie.bots.hairto.testnet';
const DUEL = 7;
const event = (name: string, data: object) =>
  `EVENT_JSON:${JSON.stringify({ standard: 'hairto', version: '1.0.0', event: name, data })}`;

const opened = (player: string) =>
  event('position_opened', {
    duel_id: DUEL,
    side: player === BOT ? 'Bot' : 'Fighter',
    player,
    open_tick: 3,
  });
const closed = event('position_closed', {
  duel_id: DUEL,
  side: 'Bot',
  player: BOT,
  dir: 'Short',
  close_tick: 9,
  net_pnl_ppm: 2400,
  self_delta: 0,
  opponent_delta: -120,
  hp_fighter: 880,
  hp_bot: 1000,
});

interface Receipt {
  id: string;
  executor?: string;
  logs: string[];
  failed?: boolean;
}

function outcome(hash: string, signer: string, receipts: Receipt[]): FinalExecutionOutcome {
  return {
    status: { SuccessValue: '' },
    transaction: { hash, signer_id: signer, receiver_id: ARENA },
    transaction_outcome: { id: hash, outcome: { logs: [], status: { SuccessValue: '' } } },
    receipts_outcome: receipts.map((r) => ({
      id: r.id,
      outcome: {
        executor_id: r.executor ?? ARENA,
        logs: r.logs,
        status: r.failed ? { Failure: { ActionError: {} } } : { SuccessValue: '' },
      },
    })),
  } as unknown as FinalExecutionOutcome;
}

const chainDuel = {
  duel_id: DUEL,
  fighter: FIGHTER,
  bot: BOT,
  bot_level: 1,
  asset_id: 2,
  start_ms: 1_800_000_000_000,
};

function setup() {
  const redis = new MemoryRedis();
  const sent: FinalExecutionOutcome[] = [];
  const rpc = new Map<string, FinalExecutionOutcome>();
  const rpcCalls: string[] = [];
  const near = {
    contracts: { arena: ARENA },
    view: async (_contract: string, method: string, args: { duel_id: number }) =>
      method === 'get_duel' && args.duel_id === DUEL ? chainDuel : null,
    call: async () => {
      const next = sent.shift()!;
      return { txHash: next.transaction!.hash, value: undefined, outcome: next };
    },
    near: {
      getTransactionStatus: async (hash: string, sender: string) => {
        rpcCalls.push(`${hash}:${sender}`);
        const found = rpc.get(hash);
        if (!found) throw new Error('UNKNOWN_TRANSACTION');
        return found;
      },
    },
  } as unknown as NearService;
  const arena = new ArenaClient(near);
  const stream = new OutcomeStream(redis.service);
  new OutcomeRelay(arena, stream).onModuleInit();
  const config = {
    get: (key: string) => (key === 'REALTIME_EVENTS_ENABLED' ? false : 1000),
  };
  const publisher = new DuelEventPublisher(
    redis.service,
    new DuelLiveStore(redis.service),
    { duel: { startingHp: 1000 } } as never,
    config as never,
    new OutcomeEventSource(stream, arena),
  );
  const prisma = { duel: { findUnique: async () => null } };
  const relays = new DuelTxRelayService(near, arena, prisma as never, stream);
  const room = () =>
    redis.published
      .filter((p) => p.channel === `duel:${DUEL}`)
      .map((p) => p.payload as { event: string; data: Record<string, unknown> });
  return { redis, sent, rpc, rpcCalls, arena, stream, publisher, relays, room };
}

/** Lets the background relay of a send finish. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('relayedOutcome', () => {
  it('keeps the duel logs of executed arena receipts, numbered among all of the receipt logs', () => {
    const tx = outcome('Tx1', FIGHTER, [
      {
        id: 'R1',
        logs: ['plain text', opened(FIGHTER), event('result_recorded', { duel_id: DUEL })],
      },
      { id: 'R2', executor: 'usdc.hairto.testnet', logs: [opened(FIGHTER)] },
      { id: 'R3', logs: [opened(FIGHTER)], failed: true },
      { id: 'R4', logs: [event('duel_voided', { duel_id: 99 })] },
    ]);
    expect(relayedOutcome(tx, ARENA)).toEqual({
      txHash: 'Tx1',
      receipts: [
        { receiptId: 'R1', executor: ARENA, logs: [{ logIndex: 1, log: opened(FIGHTER) }] },
        {
          receiptId: 'R4',
          executor: ARENA,
          logs: [{ logIndex: 0, log: event('duel_voided', { duel_id: 99 }) }],
        },
      ],
    });
    expect(relayedOutcome(tx, ARENA, DUEL)!.receipts.map((r) => r.receiptId)).toEqual(['R1']);
    expect(relayedOutcome(outcome('Tx2', FIGHTER, [{ id: 'R', logs: ['x'] }]), ARENA)).toBeNull();
  });
});

describe('realtime relay', () => {
  it("delivers the bot's close_position HP update from the worker's own outcome", async () => {
    const t = setup();
    await t.publisher.runOnce(); // first start: follows from the current head
    t.sent.push(outcome('BotOpen', BOT, [{ id: 'RB1', logs: [opened(BOT)] }]));
    t.sent.push(outcome('BotClose', BOT, [{ id: 'RB2', logs: [closed] }]));
    await t.arena.openPosition(1, DUEL, 'Y29tbWl0');
    await t.arena.closePosition(1, DUEL, 'Short', 'c2FsdA==');
    await settle();

    await expect(t.stream.head()).resolves.toBe(2n);
    await expect(t.publisher.runOnce()).resolves.toMatchObject({ handled: 2 });
    const hp = t.room().find((m) => m.event === WS_EVENTS.hpUpdate);
    expect(hp?.data).toMatchObject({
      duelId: String(DUEL),
      hpFighter: 880,
      hpBot: 1000,
      lastClosed: { player: BOT, dir: 2, pnlPpm: 2400, opponentDelta: -120, penalized: false },
    });
    const steps = t.redis.lists.get(onchainKey(String(DUEL)))!.map((s) => JSON.parse(s));
    expect(steps.map((s) => [s.kind, s.side, s.txHash])).toEqual([
      ['opened', 'bot', 'BotOpen'],
      ['closed', 'bot', 'BotClose'],
    ]);
  });

  it("relays the Fighter's open_position from the RPC outcome, never from the client", async () => {
    const t = setup();
    await t.publisher.runOnce();
    const hash = 'A'.repeat(44);
    t.rpc.set(
      hash,
      outcome(hash, FIGHTER, [
        {
          id: 'RF1',
          logs: [
            opened(FIGHTER),
            event('position_opened', { duel_id: 8, player: FIGHTER, open_tick: 1 }),
          ],
        },
      ]),
    );
    await expect(t.relays.relay(BigInt(DUEL), FIGHTER, hash)).resolves.toEqual({ events: 1 });
    expect(t.rpcCalls).toEqual([`${hash}:${FIGHTER}`]);

    await t.publisher.runOnce();
    expect(t.room().map((m) => [m.event, m.data.player, m.data.state, m.data.tick])).toEqual([
      [WS_EVENTS.duelPosition, FIGHTER, 'opened', 3],
    ]);
  });

  it('delivers a transaction relayed twice, or by the worker and the Fighter, once', async () => {
    const t = setup();
    await t.publisher.runOnce();
    const hash = 'B'.repeat(44);
    const tx = outcome(hash, FIGHTER, [{ id: 'RF2', logs: [opened(FIGHTER)] }]);
    t.rpc.set(hash, tx);
    await t.relays.relay(BigInt(DUEL), FIGHTER, hash);
    await t.relays.relay(BigInt(DUEL), FIGHTER, hash);
    await t.stream.push(relayedOutcome(tx, ARENA)!);
    expect(t.redis.streams.get(OUTCOME_STREAM)).toHaveLength(3);

    await expect(t.publisher.runOnce()).resolves.toMatchObject({ handled: 1 });
    await t.publisher.runOnce();
    expect(t.room().filter((m) => m.event === WS_EVENTS.duelPosition)).toHaveLength(1);
  });

  it("rejects someone else's transaction and publishes nothing", async () => {
    const t = setup();
    await t.publisher.runOnce();
    const hash = 'C'.repeat(44);
    t.rpc.set(hash, outcome(hash, 'mallory.testnet', [{ id: 'RM', logs: [opened(FIGHTER)] }]));
    await expect(t.relays.relay(BigInt(DUEL), FIGHTER, hash)).rejects.toMatchObject({
      status: 403,
    });
    // A session that is not the duel's Fighter is refused before any RPC call.
    await expect(t.relays.relay(BigInt(DUEL), 'mallory.testnet', hash)).rejects.toBeInstanceOf(
      AppException,
    );
    expect(t.rpcCalls).toEqual([`${hash}:${FIGHTER}`]);
    await expect(t.stream.head()).resolves.toBe(0n);
    await t.publisher.runOnce();
    expect(t.room()).toEqual([]);
  });

  it('answers 404 for a duel that exists nowhere and 400 for an unknown hash', async () => {
    const t = setup();
    await expect(t.relays.relay(99n, FIGHTER, 'D'.repeat(44))).rejects.toMatchObject({
      status: 404,
    });
    await expect(t.relays.relay(BigInt(DUEL), FIGHTER, 'D'.repeat(44))).rejects.toMatchObject({
      status: 400,
    });
  });
});
