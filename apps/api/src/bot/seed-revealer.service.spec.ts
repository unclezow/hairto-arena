import { FakeBotGateway } from '../../test/helpers/fake-bot-gateway.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { BotSeedStore } from './seed-store.js';
import { SeedRevealer } from './seed-revealer.service.js';
import { hashSeed } from './seed.js';

const FIGHTER = 'fighter.testnet';
const SEED = 'ab'.repeat(32);

function setup(createdAgoMs = 1_000) {
  const gateway = new FakeBotGateway();
  const duelId = gateway.startDuel({
    level: 1,
    fighter: FIGHTER,
    assetId: 2,
    seedHash: hashSeed(SEED, FIGHTER, 0),
  });
  const row = {
    duelId,
    seed: `stored:${SEED}`,
    revealedAt: null as Date | null,
    unrevealedAt: null as Date | null,
    duel: { createdAt: new Date(Date.now() - createdAgoMs), bot: { level: 1 } },
  };
  const prisma = {
    botSeed: {
      findMany: async () => (row.revealedAt || row.unrevealedAt ? [] : [row]),
      update: async ({ data }: { data: Partial<typeof row> }) => Object.assign(row, data),
    },
  } as unknown as PrismaService;
  const seeds = { decrypt: (v: string) => v.slice('stored:'.length) } as unknown as BotSeedStore;
  const config = { get: () => 600 };
  const revealer = new SeedRevealer(prisma, seeds, config as never, gateway);
  return { revealer, gateway, duelId, row };
}

describe('SeedRevealer', () => {
  it('waits while the duel is still running', async () => {
    const s = setup();
    await expect(s.revealer.run()).resolves.toEqual({ revealed: [], flagged: [] });
    expect(s.gateway.count('revealSeed')).toBe(0);
  });

  it('reveals the seed once the duel is terminal and stores it in clear', async () => {
    const s = setup();
    s.gateway.finish(s.duelId);
    await expect(s.revealer.run()).resolves.toEqual({ revealed: [Number(s.duelId)], flagged: [] });
    expect(s.row.seed).toBe(SEED);
    expect(s.row.revealedAt).toBeInstanceOf(Date);
  });

  it('marks the seed revealed when the arena no longer has the duel', async () => {
    const s = setup();
    s.gateway.duels.delete(s.duelId);
    await expect(s.revealer.run()).resolves.toEqual({ revealed: [Number(s.duelId)], flagged: [] });
    expect(s.gateway.count('revealSeed')).toBe(0);
  });

  it('flags a seed still unrevealed after the timeout', async () => {
    const s = setup(601_000);
    s.gateway.finish(s.duelId);
    s.gateway.failNext.set('revealSeed', new Error('rpc down'));
    await expect(s.revealer.run()).resolves.toEqual({ revealed: [], flagged: [Number(s.duelId)] });
    expect(s.row.unrevealedAt).toBeInstanceOf(Date);
  });
});
