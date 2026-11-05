import { ArenaClient } from './arena.client.js';
import type { NearService } from './near.service.js';
import { UsdcClient } from './usdc.client.js';
import { VaultClient } from './vault.client.js';

function fakeNear(views: Record<string, unknown> = {}) {
  const view = vi.fn(async (_contract: string, method: string) => views[method]);
  const call = vi.fn(async () => ({ txHash: 'Tx1', value: undefined, outcome: {} }));
  const near = {
    contracts: {
      arena: 'arena.hairto.testnet',
      vault: 'vault.hairto.testnet',
      usdc: 'usdc.hairto.testnet',
      characters: 'characters.hairto.testnet',
    },
    view,
    call,
  } as unknown as NearService;
  return { near, view, call };
}

describe('ArenaClient', () => {
  it('reads views with snake_case arguments', async () => {
    const { near, view } = fakeNear({
      active_duel_of: { Active: { duel_id: 5 } },
      nonce_of: 3,
      pot_of: '1500000',
    });
    const arena = new ArenaClient(near);
    await expect(arena.activeDuelOf('fighter.testnet')).resolves.toEqual({
      Active: { duel_id: 5 },
    });
    await expect(arena.nonceOf('fighter.testnet')).resolves.toBe(3);
    await expect(arena.potOf(2)).resolves.toBe(1_500_000n);
    await arena.getPosition(5n, 'Bot');
    expect(view).toHaveBeenCalledWith('arena.hairto.testnet', 'active_duel_of', {
      fighter: 'fighter.testnet',
    });
    expect(view).toHaveBeenCalledWith('arena.hairto.testnet', 'get_position', {
      duel_id: 5,
      side: 'Bot',
    });
  });

  it('falls back to safe defaults when a view returns nothing', async () => {
    const arena = new ArenaClient(fakeNear().near);
    await expect(arena.getDuel(1)).resolves.toBeNull();
    await expect(arena.isStale(2)).resolves.toBe(true);
    await expect(arena.nonceOf('a.testnet')).resolves.toBe(0);
    await expect(arena.getConfig()).rejects.toThrow('get_config returned nothing');
  });

  it('signs bot moves with the level key and keeper actions with the keeper key', async () => {
    const { near, call } = fakeNear();
    const arena = new ArenaClient(near);
    await arena.openPosition(2, 9n, 'Y29tbWl0');
    await arena.closePosition(2, 9n, 'Short', 'c2FsdA==');
    await arena.settleDuel(9n);
    await arena.revealBotSeed(9n, 'c2VlZA==');
    await arena.postResults({
      season: 1,
      prizeRoot: 'cA==',
      bonusRoot: 'Yg==',
      prizeTotal: 75n,
      bonusTotal: 25n,
    });
    expect(call.mock.calls).toEqual([
      [
        'bot:2',
        'arena.hairto.testnet',
        'open_position',
        { duel_id: 9, commit: 'Y29tbWl0' },
        { tgas: 20, waitUntil: undefined },
      ],
      [
        'bot:2',
        'arena.hairto.testnet',
        'close_position',
        { duel_id: 9, dir: 'Short', salt: 'c2FsdA==' },
        { tgas: 40, waitUntil: undefined },
      ],
      [
        'keeper',
        'arena.hairto.testnet',
        'settle_duel',
        { duel_id: 9 },
        { tgas: 80, waitUntil: 'FINAL' },
      ],
      [
        'keeper',
        'arena.hairto.testnet',
        'reveal_bot_seed',
        { duel_id: 9, seed: 'c2VlZA==', decisions_hash: null },
        { tgas: 50, waitUntil: 'FINAL' },
      ],
      [
        'keeper',
        'arena.hairto.testnet',
        'post_results',
        { season: 1, prize_root: 'cA==', bonus_root: 'Yg==', prize_total: '75', bonus_total: '25' },
        { tgas: 30, waitUntil: 'FINAL' },
      ],
    ]);
  });

  it('pushes ticks on the pusher key with the given gas', async () => {
    const { near, call } = fakeNear();
    const ticks = [{ asset_id: 2, price: 100_000_000, expo: -8, publish_ms: 1 }];
    await new ArenaClient(near).pushTicks(ticks, 40);
    expect(call).toHaveBeenCalledWith(
      'pusher',
      'arena.hairto.testnet',
      'push_ticks',
      { ticks },
      {
        tgas: 40,
        waitUntil: undefined,
      },
    );
  });
});

describe('VaultClient and UsdcClient', () => {
  it('read balances as bigints', async () => {
    const { near } = fakeNear({ twab_of: '250', ft_balance_of: '10000000' });
    await expect(new VaultClient(near).twabOf('b.testnet', 0, 10)).resolves.toBe(250n);
    await expect(new UsdcClient(near).balanceOf('b.testnet')).resolves.toBe(10_000_000n);
    await expect(new UsdcClient(near).faucetInfo('b.testnet')).resolves.toBeNull();
  });

  it('harvests on the vault contract with finality', async () => {
    const { near, call } = fakeNear();
    await new VaultClient(near).harvest();
    expect(call).toHaveBeenCalledWith(
      'keeper',
      'vault.hairto.testnet',
      'harvest',
      {},
      {
        tgas: 100,
        waitUntil: 'FINAL',
      },
    );
  });
});
