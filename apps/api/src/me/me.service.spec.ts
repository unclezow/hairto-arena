import { MeService } from './me.service.js';

function service(
  over: { count?: number; role?: 'Fighter' | 'Backer' | null; principal?: bigint } = {},
) {
  const prisma = { duel: { count: async () => over.count ?? 0 } };
  const wallets = {
    play: () => ({ canPlay: true, reason: null }),
    pick: async () => ({ canPick: false, reason: 'WRONG_ROLE', pickedFighter: null }),
    roleOf: (p: { fighter: bigint; backer: bigint }) =>
      p.fighter > 0n ? 'fighter' : p.backer > 0n ? 'backer' : 'none',
    minimums: { fighter: 10_000_000n, backer: 100_000_000n },
  };
  const chain = {
    roleOf: async () => over.role ?? 'Fighter',
    principalOf: async () => over.principal ?? 25_000_000n,
  };
  const usdc = {
    balanceOf: async () => 5_000_000n,
    storageBalanceOf: async () => ({ total: '1', available: '0' }),
  };
  const vault = { storageBalanceOf: async () => null };
  return new MeService(
    prisma as never,
    {} as never,
    wallets as never,
    {} as never,
    {} as never,
    { current: async () => null } as never,
    {} as never,
    chain as never,
    usdc as never,
    vault as never,
  );
}

describe('MeService', () => {
  it('counts duels played today without a daily cap', async () => {
    await expect(
      service({ count: 57 }).daily('fighter.testnet', new Date('2026-11-04T12:00:00Z')),
    ).resolves.toEqual({
      played: 57,
      cap: null,
      resetsAt: '2026-11-05T00:00:00.000Z',
    });
  });

  it('reads the live principal into the pool of the account role, with USDC and registrations', async () => {
    const status = await service({ role: 'Backer', principal: 150_000_000n }).status(
      'backer.testnet',
      true,
    );
    expect(status).toMatchObject({
      accountId: 'backer.testnet',
      principal: { fighter: 0n, backer: 150_000_000n },
      source: 'chain',
      role: 'backer',
      wallet: { usdc: 5_000_000n, usdcRegistered: true, vaultRegistered: false },
    });
  });
});
