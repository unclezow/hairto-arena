import { validateEnv } from './env.js';

const PUSHER_KEY = `ed25519:${'1'.repeat(64)}`;

describe('validateEnv', () => {
  it('boots with defaults for the local stack and testnet', () => {
    const env = validateEnv({});
    expect(env.PORT).toBe(3001);
    expect(env.NEAR_NETWORK).toBe('testnet');
    expect(env.NEAR_RPC_URL).toBeUndefined();
    expect(env.ADMIN_ACCOUNTS).toEqual([]);
    expect(env.PUSHER_GAS_KEY_LANES).toBe(8);
    expect(env.INDEXER_SCHEMA).toBe('chain');
  });

  it('does not require signer keys, so the HTTP process never needs them', () => {
    const env = validateEnv({});
    expect(env.PUSHER_GAS_KEY).toBeUndefined();
    expect(env.KEEPER_KEY).toBeUndefined();
    expect(env.BOT_LV1_GAS_KEY).toBeUndefined();
    expect(env.BOT_SERVICE_TICKET_KEY).toBeUndefined();
  });

  it('accepts ed25519 secret keys and contract id overrides', () => {
    const env = validateEnv({ PUSHER_GAS_KEY: PUSHER_KEY, ARENA_ID: 'Arena2.hairto.testnet' });
    expect(env.PUSHER_GAS_KEY).toBe(PUSHER_KEY);
    expect(env.ARENA_ID).toBe('arena2.hairto.testnet');
  });

  it('rejects a malformed value and names the variable', () => {
    expect(() => validateEnv({ DATABASE_URL: 123, PUSHER_GAS_KEY: 'abcd' })).toThrow(
      /PUSHER_GAS_KEY/,
    );
    expect(() => validateEnv({ NEAR_RPC_URL: 'not a url' })).toThrow(/NEAR_RPC_URL/);
    expect(() => validateEnv({ BOT_LV2_ACCOUNT_ID: 'bad..id' })).toThrow(/BOT_LV2_ACCOUNT_ID/);
    expect(() => validateEnv({ BOT_GAS_KEY_LANES: '0' })).toThrow(/BOT_GAS_KEY_LANES/);
  });

  it('lowercases the admin allowlist and rejects bad account ids', () => {
    const implicit = 'ab'.repeat(32);
    const env = validateEnv({ ADMIN_ACCOUNTS: `Owner.Hairto.testnet, ${implicit}` });
    expect(env.ADMIN_ACCOUNTS).toEqual(['owner.hairto.testnet', implicit]);
    expect(() => validateEnv({ ADMIN_ACCOUNTS: 'no spaces allowed' })).toThrow(/ADMIN_ACCOUNTS/);
    expect(() => validateEnv({ ADMIN_ACCOUNTS: 'a' })).toThrow(/ADMIN_ACCOUNTS/);
  });

  it('treats blank values from a .env template as unset', () => {
    const env = validateEnv({
      PUSHER_GAS_KEY: '',
      BOT_SEED_ENCRYPTION_KEY: '',
      PYTH_API_KEY: '',
      PORT: '',
    });
    expect(env.PUSHER_GAS_KEY).toBeUndefined();
    expect(env.BOT_SEED_ENCRYPTION_KEY).toBeUndefined();
    expect(env.PORT).toBe(3001);
  });

  describe('production', () => {
    const prod = {
      NODE_ENV: 'production',
      BOT_SEED_ENCRYPTION_KEY: 'ab'.repeat(32),
      PRICE_SOURCE: 'hyperliquid',
      NEAR_NETWORK: 'testnet',
      AUTH_DOMAIN: 'hairto.example',
      WEB_ORIGIN: 'https://hairto.example',
    };

    it('boots with every deployment value set', () => {
      expect(validateEnv(prod).TRUST_PROXY).toBe(0);
    });

    it.each([
      ['BOT_SEED_ENCRYPTION_KEY', undefined],
      ['PRICE_SOURCE', undefined],
      ['PRICE_SOURCE', 'mock'],
      ['NEAR_NETWORK', undefined],
      ['AUTH_DOMAIN', undefined],
      ['AUTH_DOMAIN', 'localhost'],
      ['WEB_ORIGIN', undefined],
      ['WEB_ORIGIN', 'http://localhost:3000'],
    ])('refuses %s = %s', (key, value) => {
      const raw: Record<string, unknown> = { ...prod, [key]: value };
      if (value === undefined) delete raw[key];
      expect(() => validateEnv(raw)).toThrow(new RegExp(key));
    });
  });
});
