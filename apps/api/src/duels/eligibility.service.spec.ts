import { EligibilityService } from './eligibility.service.js';

const FIGHTER = 'fighter.testnet';

function setup(over: {
  market?: { closedReason: string | null } | null;
  recentDuel?: boolean;
  slot?: unknown;
  bot?: boolean;
  canPlay?: boolean;
}) {
  const canPlay = vi.fn(async () => over.canPlay ?? true);
  const service = new EligibilityService(
    {
      bot: { findFirst: async () => (over.bot === false ? null : { id: 1 }) },
      duel: { findFirst: async () => (over.recentDuel ? { id: 9n } : null) },
    } as never,
    {
      get: async () => (over.market === undefined ? { closedReason: null } : over.market),
    } as never,
    { canPlay, activeDuelOf: async () => over.slot ?? null } as never,
  );
  return { service, canPlay };
}

const body = { assetId: 2, botLevel: 1 };

describe('EligibilityService', () => {
  it('lets an eligible Fighter through without a daily limit', async () => {
    await expect(setup({}).service.check(FIGHTER, body)).resolves.toEqual({
      counted: true,
      remainingCounted: null,
    });
  });

  it.each([
    ['a closed market', { market: { closedReason: 'session' } }, 'ARENA_CLOSED'],
    ['an unknown market', { market: null }, 'ARENA_CLOSED'],
    ['a stale quote', { market: { closedReason: 'stale' } }, 'ORACLE_UNAVAILABLE'],
    ['a running duel in the arena', { slot: { Active: { duel_id: 3 } } }, 'DUEL_IN_PROGRESS'],
    [
      'a pending duel in the arena',
      { slot: { Pending: { nonce: 1, since_ms: 0 } } },
      'DUEL_IN_PROGRESS',
    ],
    ['a duel recorded seconds ago', { recentDuel: true }, 'DUEL_IN_PROGRESS'],
    ['no enabled bot at the level', { bot: false }, 'BOT_UNAVAILABLE'],
    ['too little Fighter principal', { canPlay: false }, 'NOT_ELIGIBLE'],
  ] as const)('rejects %s', async (_name, over, code) => {
    await expect(setup(over).service.check(FIGHTER, body)).rejects.toMatchObject({ code });
  });

  it('does not ask the vault when an earlier check already failed', async () => {
    const s = setup({ market: { closedReason: 'disabled' } });
    await expect(s.service.check(FIGHTER, body)).rejects.toBeDefined();
    expect(s.canPlay).not.toHaveBeenCalled();
  });
});
