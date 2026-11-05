import { DUEL } from '@hairto-arena/shared';
import type { ParamsService } from '../config/params.service.js';
import { DuelSettler } from './duel-settler.service.js';
import type { SettlerChain, SettlerDuel } from './settler-chain.js';

const NOW = 1_800_000_100_000;

function setup(chainDuels: Record<string, SettlerDuel | null>, lost: bigint[] = []) {
  const startAt = new Date(NOW - 60_000);
  const prisma = {
    duel: {
      findMany: async () => Object.keys(chainDuels).map((id) => ({ id: BigInt(id), startAt })),
    },
    botSeed: { findMany: async () => lost.map((duelId) => ({ duelId })) },
  };
  const locks = new Set<string>();
  const redis = {
    client: {
      set: async (key: string) => (locks.has(key) ? null : (locks.add(key), 'OK')),
      sadd: async () => 1,
      srem: async () => 1,
    },
  };
  const calls: string[] = [];
  const chain: SettlerChain = {
    getDuel: async (id) => chainDuels[id.toString()] ?? null,
    settleDuel: async (id) => {
      calls.push(`settle:${id}`);
      chainDuels[id.toString()] = {
        ...chainDuels[id.toString()]!,
        status: 'Finished',
        settledMs: NOW,
      };
    },
    voidDuel: async (id) => void calls.push(`void:${id}`),
    pruneDuel: async (id) => void calls.push(`prune:${id}`),
  };
  const config = { get: () => 300 };
  const params = { duel: DUEL } as unknown as ParamsService;
  const settler = new DuelSettler(prisma as never, redis as never, params, config as never, chain);
  return { settler, calls };
}

const duel = (over: Partial<SettlerDuel>): SettlerDuel => ({
  status: 'Active',
  fighter: 'fighter.testnet',
  effectiveEndMs: NOW - 12_000,
  settledMs: null,
  ...over,
});

describe('DuelSettler', () => {
  it('settles a duel whose grace window ended 2 seconds ago', async () => {
    const s = setup({ 1: duel({}) });
    const report = await s.settler.runOnce(new Date(NOW));
    expect(s.calls).toEqual(['settle:1']);
    expect(report.settled).toEqual([1]);
  });

  it('waits for the effective end plus the margin, and skips terminal or deleted duels', async () => {
    const s = setup({
      2: duel({ effectiveEndMs: NOW - 5_000 }),
      3: duel({ status: 'Finished', settledMs: NOW - 1 }),
      4: null,
    });
    await s.settler.runOnce(new Date(NOW));
    expect(s.calls).toEqual([]);
  });

  it('voids signalled duels that are still running', async () => {
    const s = setup({ 5: duel({}), 6: duel({ status: 'Voided' }) });
    const report = await s.settler.voidDuels([5n, 6n]);
    expect(s.calls).toEqual(['void:5']);
    expect(report.voided).toEqual([5]);
  });

  it('prunes a duel whose seed was not revealed within the timeout', async () => {
    const overdue = NOW - DUEL.seedRevealTimeoutMs - 1;
    const s = setup(
      {
        7: duel({ status: 'Finished', settledMs: overdue }),
        8: duel({ status: 'Finished', settledMs: NOW - 1_000 }),
      },
      [7n, 8n],
    );
    const report = await s.settler.runOnce(new Date(NOW));
    expect(s.calls).toEqual(['prune:7']);
    expect(report.pruned).toEqual([7]);
  });
});
