import { fromBase64, ticketMessage } from '@hairto-arena/shared';
import { ed25519 } from '@noble/curves/ed25519.js';
import { generateKey } from 'near-kit';
import {
  BOT_ACCOUNT,
  FakeBotGateway,
  ManualTicks,
  MemoryRunnerState,
} from '../../test/helpers/fake-bot-gateway.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { defaultBotConfig } from './bot-config.js';
import { BotDuelService, TICKET_LIFETIME_MS, WATCH_AFTER_DEADLINE_MS } from './bot-duel.service.js';
import { BotChainError } from './bot-gateway.js';
import type { DuelRecorder, RecordDuelInput } from './duel-recorder.js';
import type { PricePrimer } from './price-primer.js';
import type { RedisRunnerState } from './runner-state.js';
import type { BotSeedStore, PendingTicketInput } from './seed-store.js';
import { hashSeed } from './seed.js';

const FIGHTER = 'fighter.testnet';
const ARENA = 'arena.hairto.testnet';

/** Pending tickets and duel seeds in memory, shaped like the Prisma rows. */
class MemorySeeds {
  pending = new Map<string, PendingTicketInput & { createdAt: Date }>();
  duelSeeds = new Map<bigint, string>();

  async savePending(input: PendingTicketInput) {
    this.pending.set(input.seedHash, { ...input, createdAt: new Date() });
  }
  async deletePending(seedHash: string) {
    this.pending.delete(seedHash);
  }
  async listPending() {
    return [...this.pending.values()].map((p) => ({
      seedHash: p.seedHash,
      fighterAddress: p.fighter,
      botLevel: p.botLevel,
      botAddress: p.botAccount,
      assetId: p.assetId,
      nonce: BigInt(p.nonce),
      deadlineAt: new Date(p.deadlineMs),
    }));
  }
  async loadSeed(duelId: bigint) {
    return this.duelSeeds.get(duelId) ?? null;
  }
}

function setup(options: { primeFails?: boolean; levels?: (1 | 2 | 3)[] } = {}) {
  const gateway = new FakeBotGateway();
  gateway.startMs = Date.now() + 5_000;
  const seeds = new MemorySeeds();
  const recorded: RecordDuelInput[] = [];
  const duels = new Map<bigint, RecordDuelInput>();
  const recorder = {
    record: vi.fn(async (input: RecordDuelInput) => {
      recorded.push(input);
      duels.set(input.duelId, input);
      const pending = seeds.pending.get(input.seedHash);
      if (pending) {
        seeds.duelSeeds.set(input.duelId, pending.seed);
        seeds.pending.delete(input.seedHash);
      }
      return { level: input.level, strategy: 'trend', config: defaultBotConfig(input.level) };
    }),
  } as unknown as DuelRecorder;
  const prisma = {
    duel: {
      findUnique: async ({ where }: { where: { id: bigint } }) => {
        const d = duels.get(where.id);
        if (!d) return null;
        return {
          id: d.duelId,
          assetId: d.assetId,
          startAt: new Date(d.startMs),
          botConfig: { level: d.level, strategy: 'trend', config: defaultBotConfig(d.level) },
          bot: { level: d.level, address: d.botAccount },
        };
      },
    },
  } as unknown as PrismaService;
  const primer = {
    prime: vi.fn(async () => {
      if (options.primeFails) throw new BotChainError('ORACLE_UNAVAILABLE', 'No fresh price');
    }),
  } as unknown as PricePrimer;
  const service = new BotDuelService(
    prisma,
    seeds as unknown as BotSeedStore,
    recorder,
    new MemoryRunnerState() as unknown as RedisRunnerState,
    gateway,
    new ManualTicks(),
    primer,
  );
  service.pollMs = 5;
  const key = generateKey();
  service.configure({
    arenaId: ARENA,
    ticketKey: key.secretKey as never,
    levels: options.levels ?? [1, 2, 3],
  });
  return { service, gateway, seeds, recorded, key };
}

/** A `now` that puts the end of watching `ms` from the real now. */
const watchEndsIn = (ms: number) => Date.now() - TICKET_LIFETIME_MS - WATCH_AFTER_DEADLINE_MS + ms;

describe('BotDuelService tickets', () => {
  it('issues a ticket whose seed hash binds the fighter and nonce and whose signature verifies', async () => {
    const s = setup();
    s.gateway.nonces.set(FIGHTER, 4);
    const before = Date.now();
    const issued = await s.service.issueTicket({ fighter: FIGHTER, assetId: 2, botLevel: 2 });
    s.service.stopAll();

    const pending = s.seeds.pending.get(issued.ticket.seed_hash)!;
    expect(issued.ticket).toMatchObject({ fighter: FIGHTER, asset_id: 2, bot_level: 2, nonce: 4 });
    expect(issued.ticket.seed_hash).toBe(hashSeed(pending.seed, FIGHTER, 4));
    expect(issued.deadlineMs - before).toBeGreaterThanOrEqual(TICKET_LIFETIME_MS);
    expect(issued.deadlineMs - before).toBeLessThan(TICKET_LIFETIME_MS + 1_000);
    expect(pending).toMatchObject({ botAccount: BOT_ACCOUNT[2], assetId: 2, nonce: 4 });

    const message = ticketMessage(ARENA, {
      fighter: FIGHTER,
      assetId: 2,
      botLevel: 2,
      seedHash: fromBase64(issued.ticket.seed_hash),
      nonce: 4n,
      deadlineMs: BigInt(issued.deadlineMs),
    });
    expect(ed25519.verify(fromBase64(issued.signature), message, s.key.publicKey.data)).toBe(true);
  });

  it('stores no seed when the price cannot be primed', async () => {
    const s = setup({ primeFails: true });
    await expect(
      s.service.issueTicket({ fighter: FIGHTER, assetId: 2, botLevel: 1 }),
    ).rejects.toMatchObject({ code: 'ORACLE_UNAVAILABLE' });
    expect(s.seeds.pending.size).toBe(0);
  });

  it('refuses a level that did not pass the boot check', async () => {
    const s = setup({ levels: [1] });
    await expect(
      s.service.issueTicket({ fighter: FIGHTER, assetId: 2, botLevel: 3 }),
    ).rejects.toMatchObject({ code: 'BOT_UNAVAILABLE' });
    s.service.configure(null);
    await expect(
      s.service.issueTicket({ fighter: FIGHTER, assetId: 2, botLevel: 1 }),
    ).rejects.toMatchObject({ code: 'BOT_UNAVAILABLE' });
  });
});

describe('BotDuelService watcher', () => {
  it('records the duel the Fighter starts with the ticket and starts the runner', async () => {
    const s = setup();
    const issued = await s.service.issueTicket({ fighter: FIGHTER, assetId: 2, botLevel: 2 });
    // Another, older duel of the same Fighter must not be taken for this one.
    s.gateway.startDuel({ level: 2, fighter: FIGHTER, assetId: 2, seedHash: 'b3RoZXI=' });
    s.gateway.finish(1n);
    const duelId = s.gateway.startDuel({
      level: 2,
      fighter: FIGHTER,
      assetId: 2,
      seedHash: issued.ticket.seed_hash,
    });
    await vi.waitFor(() => expect(s.recorded).toHaveLength(1), { timeout: 2_000 });
    expect(s.recorded[0]).toMatchObject({
      duelId,
      fighter: FIGHTER,
      botAccount: BOT_ACCOUNT[2],
      assetId: 2,
      startMs: s.gateway.startMs,
      seedHash: issued.ticket.seed_hash,
    });
    await vi.waitFor(() => expect(s.service.activeRunners).toBe(1));
    expect(s.seeds.pending.size).toBe(0);
    s.service.stopAll();
  });

  it('deletes the pending seed when the ticket is never used', async () => {
    const s = setup();
    await s.service.issueTicket({ fighter: FIGHTER, assetId: 2, botLevel: 1 }, watchEndsIn(50));
    expect(s.seeds.pending.size).toBe(1);
    await vi.waitFor(() => expect(s.seeds.pending.size).toBe(0), { timeout: 2_000 });
    expect(s.recorded).toHaveLength(0);
  });

  it('resumes watching after a restart and records the duel once it appears', async () => {
    const first = setup();
    const issued = await first.service.issueTicket({ fighter: FIGHTER, assetId: 2, botLevel: 2 });
    first.service.stopAll();

    // A new worker with the same database and chain.
    const second = setup();
    second.seeds.pending = first.seeds.pending;
    second.gateway.startDuel({
      level: 2,
      fighter: FIGHTER,
      assetId: 2,
      seedHash: issued.ticket.seed_hash,
    });
    await expect(second.service.resumePending()).resolves.toBe(1);
    await vi.waitFor(() => expect(second.recorded).toHaveLength(1), { timeout: 2_000 });
    second.service.stopAll();
  });

  it('finds a duel that already ended while nobody watched, so its seed can still be revealed', async () => {
    const s = setup();
    const issued = await s.service.issueTicket(
      { fighter: FIGHTER, assetId: 2, botLevel: 2 },
      watchEndsIn(30),
    );
    const duelId = s.gateway.startDuel({
      level: 2,
      fighter: FIGHTER,
      assetId: 2,
      seedHash: issued.ticket.seed_hash,
    });
    s.gateway.finish(duelId);
    await vi.waitFor(() => expect(s.recorded.map((r) => r.duelId)).toEqual([duelId]), {
      timeout: 2_000,
    });
    expect(s.service.activeRunners).toBe(0);
  });
});
