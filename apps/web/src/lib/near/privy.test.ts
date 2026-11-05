import { afterEach, describe, expect, it, vi } from 'vitest';
import type Privy from '@privy-io/js-sdk-core';
import { create } from '@privy-io/js-sdk-core';
import { ensurePrivyNearWallet, signingOrigin } from './privy';

vi.mock('@privy-io/js-sdk-core', () => ({ default: class {}, LocalStorage: class {}, create: vi.fn() }));
afterEach(() => vi.clearAllMocks());

function fakePrivy(accounts: unknown[]) {
  const get = vi.fn().mockResolvedValue({ user: { linked_accounts: accounts } });
  return { get, client: { user: { get }, app: { appId: 'test-app' }, fetchPrivyRoute: vi.fn(), getCompiledPath: vi.fn() } as unknown as Privy };
}

describe('social NEAR wallet', () => {
  it('keeps an existing NEAR wallet without creating another', async () => {
    const { client } = fakePrivy([{ type: 'wallet', chain_type: 'near', address: 'a'.repeat(64) }]);
    await ensurePrivyNearWallet(client);
    expect(create).not.toHaveBeenCalled();
  });

  it('creates only a NEAR wallet and deduplicates concurrent requests', async () => {
    const { client, get } = fakePrivy([]);
    get.mockResolvedValueOnce({ user: { linked_accounts: [] } });
    get.mockResolvedValue({ user: { linked_accounts: [{ type: 'wallet', chain_type: 'near' }] } });
    const first = ensurePrivyNearWallet(client);
    const second = ensurePrivyNearWallet(client);
    expect(first).toBe(second);
    await first;
    expect(create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ app: { appId: 'test-app' } }), { request: { chain_type: 'near' } });
  });

  it('surfaces wallet creation failure and permits retry', async () => {
    const { client, get } = fakePrivy([]);
    vi.mocked(create).mockRejectedValueOnce(new Error('Creation declined'));
    await expect(ensurePrivyNearWallet(client)).rejects.toThrow('Creation declined');
    get.mockResolvedValue({ user: { linked_accounts: [{ type: 'wallet', chain_type: 'near' }] } });
    await expect(ensurePrivyNearWallet(client)).resolves.toBeUndefined();
  });

  it('fails if creation does not produce a linked NEAR wallet', async () => {
    const { client } = fakePrivy([]);
    await expect(ensurePrivyNearWallet(client)).rejects.toThrow('not ready');
  });
});

it('uses an exact signing origin and refuses paths and wildcard origins', () => {
  expect(signingOrigin('https://arena.example')).toBe('https://arena.example');
  expect(() => signingOrigin('https://arena.example/path')).toThrow('app origin');
  expect(() => signingOrigin('*')).toThrow();
  expect(() => signingOrigin('javascript:bad')).toThrow('app origin');
});
