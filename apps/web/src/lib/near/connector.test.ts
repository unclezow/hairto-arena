import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NearConnector, NearWalletBase } from '@hot-labs/near-connect';
import manifest from '../../../public/manifest.json';
import { registerPrivy, watchConnection } from './connector';

function fakeConnector() {
  const listeners = new Map<string, (event: never) => void>();
  const instance = {
    on: vi.fn((event: string, callback: (event: never) => void) => listeners.set(event, callback)),
    off: vi.fn((event: string) => listeners.delete(event)),
    getConnectedWallet: vi.fn(),
    registerWallet: vi.fn(),
    whenManifestLoaded: Promise.resolve(),
  };
  return {
    instance,
    connector: instance as unknown as NearConnector,
    emit: (event: string, payload: unknown) => listeners.get(event)?.(payload as never),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('NEAR connection lifecycle', () => {
  const wallet = {} as NearWalletBase;
  it('restores the first account without asking to sign in', async () => {
    const { instance, connector } = fakeConnector();
    instance.getConnectedWallet.mockResolvedValue({ wallet, accounts: [{ accountId: 'a.testnet' }, { accountId: 'b.testnet' }] });
    const notify = vi.fn();
    const stop = watchConnection(connector, notify);
    await Promise.resolve();
    expect(notify).toHaveBeenCalledWith({ wallet, accountId: 'a.testnet' });
    stop();
    expect(instance.off).toHaveBeenCalledTimes(2);
  });

  it('ignores a late restore after disconnect', async () => {
    const { instance, connector, emit } = fakeConnector();
    let resolve!: (value: unknown) => void;
    instance.getConnectedWallet.mockReturnValue(new Promise((done) => { resolve = done; }));
    const notify = vi.fn();
    const stop = watchConnection(connector, notify);
    emit('wallet:signOut', {});
    resolve({ wallet, accounts: [{ accountId: 'old.testnet' }] });
    await Promise.resolve();
    expect(notify).toHaveBeenCalledExactlyOnceWith({ wallet: null, accountId: null });
    stop();
  });

  it('accepts a new account and ignores restore from a previous account', async () => {
    const { instance, connector, emit } = fakeConnector();
    instance.getConnectedWallet.mockResolvedValue({ wallet, accounts: [{ accountId: 'old.testnet' }] });
    const notify = vi.fn();
    const stop = watchConnection(connector, notify);
    emit('wallet:signIn', { success: true, wallet, accounts: [{ accountId: 'new.testnet' }] });
    await Promise.resolve();
    expect(notify).toHaveBeenCalledExactlyOnceWith({ wallet, accountId: 'new.testnet' });
    stop();
  });

  it('does not publish a restore after unmount', async () => {
    const { instance, connector } = fakeConnector();
    instance.getConnectedWallet.mockResolvedValue({ wallet, accounts: [{ accountId: 'a.testnet' }] });
    const notify = vi.fn();
    watchConnection(connector, notify)();
    await Promise.resolve();
    expect(notify).not.toHaveBeenCalled();
  });

  it('registers Privy without replacing the SDK default wallet list', async () => {
    const { instance, connector } = fakeConnector();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => structuredClone(manifest) }));
    await registerPrivy(connector, 'https://arena.example');
    expect(instance.registerWallet).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      id: 'hairto-privy',
      website: 'https://arena.example',
      metadata: { signPageURL: 'https://arena.example/sign', debug: false },
      permissions: expect.objectContaining({ allowsOpen: ['https://arena.example'] }),
    }));
  });

  it('rejects an executor on a mutable branch', async () => {
    const { instance, connector } = fakeConnector();
    const unsafe = structuredClone(manifest);
    unsafe.wallets[0]!.executor = 'https://raw.githubusercontent.com/beneviolabs/privy-near-connect/main/executor.js';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => unsafe }));
    await expect(registerPrivy(connector, 'https://arena.example')).rejects.toThrow('immutable commit');
    expect(instance.registerWallet).not.toHaveBeenCalled();
  });
});
