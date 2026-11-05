import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NearWalletBase } from '@hot-labs/near-connect';
import { api } from './api';
import { getSessionToken, sessionSnapshot, setSession, setActiveAccount } from './session';
import { setWalletSessionConnection, signIn } from './wallet-auth';

const nonce = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const challenge = { message: 'Sign in to Hairto Arena', recipient: 'localhost', nonce };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const fetchMock = vi.fn<typeof fetch>();
const storage = new Map<string, string>();
function fakeWallet(accountId = 'alice.testnet') {
  const signMessage = vi.fn().mockResolvedValue({ accountId, publicKey: 'ed25519:public', signature: 'signature' });
  const wallet = { signMessage } as unknown as NearWalletBase;
  return { wallet, signMessage };
}
function connect(accountId = 'alice.testnet') {
  const result = fakeWallet(accountId);
  setWalletSessionConnection({ accountId, wallet: result.wallet });
  return result;
}

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  setWalletSessionConnection(null);
});
afterEach(() => { setWalletSessionConnection(null); vi.unstubAllGlobals(); });

describe('NEP-413 API session', () => {
  it('signs the decoded challenge once and stores the verified account token', async () => {
    const { signMessage } = connect();
    fetchMock.mockResolvedValueOnce(json(challenge)).mockResolvedValueOnce(json({ token: 'token', accountId: 'alice.testnet' }));
    const first = signIn();
    expect(signIn()).toBe(first);
    await expect(first).resolves.toBe('token');
    expect(signMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: challenge.message, recipient: challenge.recipient, nonce: new Uint8Array(32).fill(7) }));
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ accountId: 'alice.testnet' });
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ accountId: 'alice.testnet', publicKey: 'ed25519:public', signature: 'signature' });
    expect(getSessionToken('alice.testnet')).toBe('token');
    expect(storage.get('hairto:session:alice.testnet')).toContain('token');
  });

  it('allows a brand-new implicit account without an RPC account-existence check', async () => {
    const accountId = 'a'.repeat(64);
    connect(accountId);
    fetchMock.mockResolvedValueOnce(json(challenge)).mockResolvedValueOnce(json({ token: 'new', accountId }));
    await expect(signIn()).resolves.toBe('new');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('describes a declined signature and supports retry', async () => {
    const { signMessage } = connect();
    signMessage.mockRejectedValueOnce(new Error('User rejected'));
    fetchMock.mockResolvedValueOnce(json(challenge));
    await expect(signIn()).resolves.toBeNull();
    expect(sessionSnapshot()).toMatchObject({ status: 'failed', error: 'Signature declined', token: null });
    fetchMock.mockResolvedValueOnce(json(challenge)).mockResolvedValueOnce(json({ token: 'retry', accountId: 'alice.testnet' }));
    await expect(signIn()).resolves.toBe('retry');
  });

  it('displays the server rejection without recursively renewing auth requests', async () => {
    connect();
    fetchMock.mockResolvedValueOnce(json(challenge)).mockResolvedValueOnce(json({ error: { message: 'Expired nonce' } }, 401));
    await expect(signIn()).resolves.toBeNull();
    expect(sessionSnapshot().error).toBe('Expired nonce');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never exposes a token to another account or a differently cased id', () => {
    connect();
    setSession({ accountId: 'alice.testnet', token: 'alice-token' });
    expect(getSessionToken('ALICE.testnet')).toBeNull();
    connect('bob.testnet');
    expect(getSessionToken()).toBeNull();
    expect(getSessionToken('alice.testnet')).toBeNull();
  });

  it('restores a valid token after a same-tab reload', () => {
    storage.set('hairto:session:alice.testnet', JSON.stringify({ token: 'restored', accountId: 'alice.testnet' }));
    connect();
    expect(getSessionToken()).toBe('restored');
  });

  it('ignores malformed and wrong-account persisted sessions', () => {
    storage.set('hairto:session:alice.testnet', JSON.stringify({ token: 'wrong', accountId: 'bob.testnet' }));
    connect();
    expect(getSessionToken()).toBeNull();
    setActiveAccount(null);
    storage.set('hairto:session:alice.testnet', 'not JSON');
    setActiveAccount('alice.testnet');
    expect(getSessionToken()).toBeNull();
  });

  it('clears tab storage on disconnect and discards late signatures', async () => {
    const { signMessage } = connect();
    let resolve!: (value: unknown) => void;
    signMessage.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    fetchMock.mockResolvedValueOnce(json(challenge));
    const pending = signIn();
    await vi.waitFor(() => expect(signMessage).toHaveBeenCalled());
    setWalletSessionConnection(null);
    resolve({ accountId: 'alice.testnet', publicKey: 'key', signature: 'signature' });
    await expect(pending).resolves.toBeNull();
    expect(getSessionToken()).toBeNull();
    expect(storage.has('hairto:session:alice.testnet')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not accept a signature from a different account', async () => {
    const { signMessage } = connect();
    signMessage.mockResolvedValueOnce({ accountId: 'bob.testnet', publicKey: 'key', signature: 'signature' });
    fetchMock.mockResolvedValueOnce(json(challenge));
    await expect(signIn()).resolves.toBeNull();
    expect(sessionSnapshot().error).toContain('different account');
  });

  it('renews on 401 once and retries with the new token', async () => {
    connect();
    setSession({ accountId: 'alice.testnet', token: 'old' });
    fetchMock.mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json(challenge)).mockResolvedValueOnce(json({ accountId: 'alice.testnet', token: 'new' })).mockResolvedValueOnce(json({ ok: true }));
    await expect(api('/me/status')).resolves.toEqual({ ok: true });
    expect(new Headers(fetchMock.mock.calls[0]![1]!.headers).get('authorization')).toBe('Bearer old');
    expect(new Headers(fetchMock.mock.calls[3]![1]!.headers).get('authorization')).toBe('Bearer new');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not renew again if the retried request also returns 401', async () => {
    connect();
    fetchMock.mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json(challenge)).mockResolvedValueOnce(json({ accountId: 'alice.testnet', token: 'new' })).mockResolvedValueOnce(json({}, 401));
    await expect(api('/me/status')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not renew a stale 401 under a newly connected account', async () => {
    connect();
    let resolve!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const pending = api('/me/status');
    connect('bob.testnet');
    resolve(json({}, 401));
    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
