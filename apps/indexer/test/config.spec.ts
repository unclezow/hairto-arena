import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('defaults to testnet, the manifest contracts and the free Neardata budget', () => {
    const c = loadConfig({ INDEXER_START_BLOCK: '182000000' });
    expect(c).toMatchObject({
      schema: 'chain',
      startBlock: 182_000_000,
      neardataUrl: 'https://testnet.neardata.xyz',
      txApiUrl: 'https://tx.test.fastnear.com',
      maxRpm: 150,
      gapFillThreshold: 300,
      gapFillSafety: 120,
      resetToHead: false,
      contracts: {
        arena: 'arena.hairto.testnet',
        vault: 'vault.hairto.testnet',
        characters: 'characters.hairto.testnet',
      },
    });
    expect(
      loadConfig({ INDEXER_START_BLOCK: '1', ARENA_ID: 'arena2.hairto.testnet' }).contracts.arena,
    ).toBe('arena2.hairto.testnet');
  });

  it('needs a start block while the manifest has none', () => {
    expect(() => loadConfig({})).toThrow('INDEXER_START_BLOCK is required');
  });

  it('refuses the development reset in production and a budget above the free limit', () => {
    expect(() =>
      loadConfig({
        INDEXER_START_BLOCK: '1',
        NODE_ENV: 'production',
        INDEXER_RESET_TO_HEAD: 'true',
      }),
    ).toThrow('refused in production');
    expect(() => loadConfig({ INDEXER_START_BLOCK: '1', NEARDATA_MAX_RPM: '200' })).toThrow(
      'NEARDATA_MAX_RPM',
    );
    expect(() => loadConfig({ INDEXER_START_BLOCK: '1', INDEXER_SCHEMA: 'x; drop' })).toThrow(
      'INDEXER_SCHEMA',
    );
  });
});
