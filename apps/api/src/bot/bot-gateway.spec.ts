import { Dir } from '@hairto-arena/shared';
import type { ArenaClient } from '../near/arena.client.js';
import { NearCallError, type NearService } from '../near/near.service.js';
import { BotChainError, NearBotGateway } from './bot-gateway.js';

function setup(overrides: Partial<Record<keyof ArenaClient, unknown>> = {}) {
  const arena = {
    openPosition: vi.fn(async () => ({})),
    closePosition: vi.fn(async () => ({})),
    revealBotSeed: vi.fn(async () => ({})),
    isStale: vi.fn(async () => false),
    getDuel: vi.fn(async () => null),
    getPosition: vi.fn(async () => null),
    ...overrides,
  } as unknown as ArenaClient;
  const near = { botAccount: (level: number) => `bot${level}.testnet` } as unknown as NearService;
  return { gateway: new NearBotGateway(near, arena), arena };
}

describe('NearBotGateway', () => {
  it('sends moves on the level key with base64 salt and named direction', async () => {
    const { gateway, arena } = setup();
    await gateway.openPosition(2, 5n, 'Y29tbWl0');
    await gateway.closePosition(2, 5n, Dir.Short, 'cd'.repeat(32));
    await gateway.revealSeed(2, 5n, 'ab'.repeat(32));
    expect(arena.openPosition).toHaveBeenCalledWith(2, 5n, 'Y29tbWl0');
    expect(arena.closePosition).toHaveBeenCalledWith(
      2,
      5n,
      'Short',
      Buffer.alloc(32, 0xcd).toString('base64'),
    );
    expect(arena.revealBotSeed).toHaveBeenCalledWith(
      5n,
      Buffer.alloc(32, 0xab).toString('base64'),
      'bot:2',
    );
  });

  it('answers isPriceFresh from is_stale', async () => {
    const stale = setup({ isStale: vi.fn(async () => true) });
    await expect(stale.gateway.isPriceFresh(2)).resolves.toBe(false);
    await expect(setup().gateway.isPriceFresh(2)).resolves.toBe(true);
  });

  it('maps the arena duel view', async () => {
    const { gateway } = setup({
      getDuel: vi.fn(async () => ({
        duel_id: 5,
        fighter: 'f.testnet',
        bot: 'bot1.testnet',
        asset_id: 2,
        bot_level: 1,
        season: 1,
        nonce: 3,
        start_ms: 1_000,
        end_ms: 31_000,
        effective_end_ms: 41_000,
        ko_ms: null,
        hp_fighter: 1000,
        hp_bot: 1000,
        seed_hash: 'aGFzaA==',
        status: 'Active',
        outcome: null,
        winner: null,
        ko: false,
        damage_config_id: 1,
        ko_immunity_ms: 5_000,
        settled_ms: null,
      })),
    });
    await expect(gateway.getDuel(5n)).resolves.toMatchObject({
      fighter: 'f.testnet',
      startMs: 1_000,
      effectiveEndMs: 41_000,
      status: 'Active',
      seedHash: 'aGFzaA==',
      nonce: 3,
    });
  });

  it('reports a failed receipt as reverted and anything else as unavailable', async () => {
    const reverted = setup({
      openPosition: vi.fn(async () => {
        throw new NearCallError('open_position', 'Tx1', 'position already open');
      }),
    });
    await expect(reverted.gateway.openPosition(1, 1n, 'x')).rejects.toMatchObject({
      code: 'CHAIN_REVERTED',
    });
    const down = setup({
      openPosition: vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    });
    await expect(down.gateway.openPosition(1, 1n, 'x')).rejects.toBeInstanceOf(BotChainError);
    await expect(down.gateway.openPosition(1, 1n, 'x')).rejects.toMatchObject({
      code: 'CHAIN_UNAVAILABLE',
    });
  });
});
