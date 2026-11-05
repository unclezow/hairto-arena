import { ConfigService } from '@nestjs/config';
import { AccountDoesNotExistError, generateKey, type KeyPair } from 'near-kit';
import { validateEnv } from '../config/env.js';
import type { NearService } from '../near/near.service.js';
import type { RedisService } from '../redis/redis.service.js';
import { AuthService, isOwnImplicitAccount, type SignInChallenge } from './auth.service.js';
import { SessionService } from './session.service.js';

/** Just enough Redis for challenges and sessions. */
function fakeRedis() {
  const store = new Map<string, string>();
  const client = {
    set: vi.fn(async (key: string, value: string) => void store.set(key, value)),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    getdel: vi.fn(async (key: string) => {
      const value = store.get(key) ?? null;
      store.delete(key);
      return value;
    }),
    del: vi.fn(async (key: string) => void store.delete(key)),
  };
  return { client } as unknown as RedisService;
}

type KeyKind = 'FullAccess' | 'FunctionCall';

/** A chain with some accounts, each holding keys of a given kind. */
function fakeNear(accounts: Record<string, Record<string, KeyKind>>, rpcDown = false) {
  const near = {
    rpc: {
      getAccount: vi.fn(async (accountId: string) => {
        if (rpcDown) throw new Error('connect ECONNREFUSED');
        if (!accounts[accountId]) throw new AccountDoesNotExistError(accountId);
        return {};
      }),
    },
    getAccessKey: vi.fn(async (accountId: string, publicKey: string) => {
      const kind = accounts[accountId]?.[publicKey];
      if (!kind) return null;
      return {
        nonce: 1,
        block_height: 1,
        block_hash: 'x',
        permission:
          kind === 'FullAccess'
            ? 'FullAccess'
            : { FunctionCall: { receiver_id: 'arena.hairto.testnet', method_names: [] } },
      };
    }),
  };
  return { near } as unknown as NearService;
}

function setup(accounts: Record<string, Record<string, KeyKind>>, rpcDown = false) {
  const config = new ConfigService(
    validateEnv({ AUTH_DOMAIN: 'hairto.example', ADMIN_ACCOUNTS: 'owner.hairto.testnet' }),
  ) as never;
  const redis = fakeRedis();
  const sessions = new SessionService(redis, config);
  const auth = new AuthService(redis, sessions, fakeNear(accounts, rpcDown), config);
  return { auth, sessions };
}

function sign(key: KeyPair, accountId: string, challenge: SignInChallenge) {
  return key.signNep413Message!(accountId, {
    message: challenge.message,
    recipient: challenge.recipient,
    nonce: Buffer.from(challenge.nonce, 'base64'),
  });
}

describe('AuthService (NEP-413)', () => {
  const full = generateKey();
  const functionCall = generateKey();
  const accounts = {
    'fighter.testnet': {
      [full.publicKey.toString()]: 'FullAccess',
      [functionCall.publicKey.toString()]: 'FunctionCall',
    },
    'owner.hairto.testnet': { [full.publicKey.toString()]: 'FullAccess' },
  } satisfies Record<string, Record<string, KeyKind>>;

  it('issues a challenge with message, recipient and a 32-byte timestamped nonce', async () => {
    const { auth } = setup(accounts);
    const before = Date.now();
    const challenge = await auth.createNonce('fighter.testnet');
    expect(challenge.recipient).toBe('hairto.example');
    expect(challenge.message).toContain('Account: fighter.testnet');
    const nonce = Buffer.from(challenge.nonce, 'base64');
    expect(nonce).toHaveLength(32);
    expect(Number(nonce.readBigUInt64BE(0))).toBeGreaterThanOrEqual(before);
    expect(new Date(challenge.expiresAt).getTime() - new Date(challenge.issuedAt).getTime()).toBe(
      600_000,
    );
  });

  it('issues a session when an existing account signs with a full-access key', async () => {
    const { auth, sessions } = setup(accounts);
    const challenge = await auth.createNonce('fighter.testnet');
    const session = await auth.verify(sign(full, 'fighter.testnet', challenge));
    expect(session).toMatchObject({ accountId: 'fighter.testnet', role: 'user' });
    await expect(sessions.get(session.token)).resolves.toMatchObject({
      accountId: 'fighter.testnet',
    });
  });

  it('rejects a replayed challenge', async () => {
    const { auth } = setup(accounts);
    const signed = sign(full, 'fighter.testnet', await auth.createNonce('fighter.testnet'));
    await auth.verify(signed);
    await expect(auth.verify(signed)).rejects.toThrow('Unknown or already used nonce');
  });

  it('rejects a function-call key of the account', async () => {
    const { auth } = setup(accounts);
    const challenge = await auth.createNonce('fighter.testnet');
    await expect(auth.verify(sign(functionCall, 'fighter.testnet', challenge))).rejects.toThrow(
      'not a full-access key',
    );
  });

  it('issues a session to a not-yet-funded implicit account signing with its own key', async () => {
    const key = generateKey();
    const implicit = Buffer.from(key.publicKey.data).toString('hex');
    const { auth } = setup(accounts);
    const challenge = await auth.createNonce(implicit);
    await expect(auth.verify(sign(key, implicit, challenge))).resolves.toMatchObject({
      accountId: implicit,
    });
  });

  it('rejects a nonexistent implicit id signed with another key', async () => {
    const owner = generateKey();
    const implicit = Buffer.from(owner.publicKey.data).toString('hex');
    const { auth } = setup(accounts);
    const challenge = await auth.createNonce(implicit);
    await expect(auth.verify(sign(generateKey(), implicit, challenge))).rejects.toThrow(
      'Account does not exist',
    );
  });

  it('rejects a named account that does not exist', async () => {
    const { auth } = setup(accounts);
    const challenge = await auth.createNonce('ghost.testnet');
    await expect(auth.verify(sign(full, 'ghost.testnet', challenge))).rejects.toThrow(
      'Account does not exist',
    );
  });

  it('rejects a signature over another message or by a key other than the one claimed', async () => {
    const { auth } = setup(accounts);
    const challenge = await auth.createNonce('fighter.testnet');
    const forged = sign(full, 'fighter.testnet', { ...challenge, message: 'something else' });
    await expect(auth.verify(forged)).rejects.toThrow('Invalid signature');

    const again = await auth.createNonce('fighter.testnet');
    const signed = sign(generateKey(), 'fighter.testnet', again);
    await expect(auth.verify({ ...signed, publicKey: full.publicKey.toString() })).rejects.toThrow(
      'Invalid signature',
    );
  });

  it('does not fall back to the implicit path when the RPC is down', async () => {
    const key = generateKey();
    const implicit = Buffer.from(key.publicKey.data).toString('hex');
    const { auth } = setup(accounts, true);
    const challenge = await auth.createNonce(implicit);
    await expect(auth.verify(sign(key, implicit, challenge))).rejects.toThrow(
      'NEAR RPC unavailable',
    );
  });

  it('gives accounts on ADMIN_ACCOUNTS the admin role', async () => {
    const { auth } = setup(accounts);
    const challenge = await auth.createNonce('owner.hairto.testnet');
    await expect(auth.verify(sign(full, 'owner.hairto.testnet', challenge))).resolves.toMatchObject(
      { role: 'admin' },
    );
  });
});

describe('isOwnImplicitAccount', () => {
  it('matches only the hex of the same ed25519 key', () => {
    const key = generateKey();
    const hex = Buffer.from(key.publicKey.data).toString('hex');
    expect(isOwnImplicitAccount(hex, key.publicKey.toString())).toBe(true);
    expect(isOwnImplicitAccount(hex, generateKey().publicKey.toString())).toBe(false);
    expect(isOwnImplicitAccount('fighter.testnet', key.publicKey.toString())).toBe(false);
    expect(isOwnImplicitAccount(hex, 'not a key')).toBe(false);
  });
});
