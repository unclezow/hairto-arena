import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AccessKeyDoesNotExistError, AccountDoesNotExistError, Near, NetworkError, generateKey } from 'near-kit';
import type { NearWalletBase } from '@hot-labs/near-connect';
import { fallbackConfig } from './config';
import { arenaCall, enableQuickPlay, PLAY_METHODS, QUICK_PLAY_ALLOWANCE, quickPlayStatus, readQuickPlayKey, removeQuickPlay, resetQuickPlayStatusCache } from './quick-play-key';

const rpc = vi.hoisted(() => ({ accountExists: vi.fn(), getAccessKey: vi.fn(), call: vi.fn(), rpc: { getAccount: vi.fn(), getAccessKey: vi.fn() } }));
vi.mock('near-kit', async (original) => {
  const actual = await original<typeof import('near-kit')>();
  return { ...actual, Near: vi.fn(function () { return rpc; }) };
});
const config = fallbackConfig();
const accountId = 'alice.testnet';
const storage = new Map<string, string>();
const send = vi.fn();
const wallet = { signAndSendTransaction: send } as unknown as NearWalletBase;
function permission(allowance = QUICK_PLAY_ALLOWANCE, methods: string[] = [...PLAY_METHODS], receiver = config.contracts.arena) {
  return { nonce: 1, permission: { FunctionCall: { receiver_id: receiver, method_names: methods, allowance } } };
}
function store(network = config.network, account = accountId) {
  const pair = generateKey();
  storage.set(`hairto:quick-play:${network}:${account}`, JSON.stringify({ publicKey: pair.publicKey.toString(), secretKey: pair.secretKey }));
  return pair.publicKey.toString();
}

beforeEach(() => {
  resetQuickPlayStatusCache();
  vi.clearAllMocks();
  storage.clear();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  rpc.accountExists.mockResolvedValue(true);
  rpc.rpc.getAccount.mockResolvedValue({ amount: '1000000000000000000000000', locked: '0', storage_usage: 0 });
  rpc.getAccessKey.mockResolvedValue(null);
  rpc.rpc.getAccessKey.mockResolvedValue(permission());
  rpc.call.mockResolvedValue({ hash: 'local-outcome' });
  send.mockResolvedValue({ transaction: { hash: 'wallet-outcome' } });
});
afterEach(() => vi.unstubAllGlobals());

describe('quick-play key permissions and persistence', () => {
  it('does not ask an unfunded account to approve AddKey', async () => {
    rpc.rpc.getAccount.mockRejectedValue(new AccountDoesNotExistError(accountId));
    await expect(quickPlayStatus(config, accountId)).resolves.toEqual({ kind: 'missing', funded: false });
    await expect(enableQuickPlay(config, accountId, wallet)).rejects.toThrow('Fund your account');
    expect(send).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
  });

  it('creates and reuses a key per account and network', async () => {
    rpc.rpc.getAccessKey.mockRejectedValueOnce(new AccessKeyDoesNotExistError(accountId, 'not-yet-added'));
    rpc.rpc.getAccessKey.mockRejectedValueOnce(new AccessKeyDoesNotExistError(accountId, 'not-yet-added'));
    await enableQuickPlay(config, accountId, wallet);
    const key = readQuickPlayKey(config.network, accountId);
    expect(key?.publicKey).toMatch(/^ed25519:/);
    expect(readQuickPlayKey('mainnet', accountId)).toBeNull();
    expect(readQuickPlayKey(config.network, 'bob.testnet')).toBeNull();
    await enableQuickPlay(config, accountId, wallet);
    expect(readQuickPlayKey(config.network, accountId)).toEqual(key);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ receiverId: accountId, actions: [{ type: 'AddKey', params: { publicKey: key!.publicKey, accessKey: { nonce: 0, permission: { receiverId: config.contracts.arena, methodNames: [...PLAY_METHODS], allowance: QUICK_PLAY_ALLOWANCE } } } }] }));
  });

  it('moves from missing through active to exhausted based on RPC allowance', async () => {
    await expect(quickPlayStatus(config, accountId)).resolves.toMatchObject({ kind: 'missing' });
    store();
    await expect(quickPlayStatus(config, accountId)).resolves.toMatchObject({ kind: 'active', allowance: QUICK_PLAY_ALLOWANCE });
    rpc.rpc.getAccessKey.mockResolvedValue(permission('0'));
    await expect(quickPlayStatus(config, accountId)).resolves.toMatchObject({ kind: 'exhausted', allowance: '0' });
  });

  it('replaces an exhausted key atomically with DeleteKey and AddKey', async () => {
    const publicKey = store();
    rpc.rpc.getAccessKey.mockResolvedValueOnce(permission('0')).mockResolvedValue(permission());
    rpc.getAccessKey.mockResolvedValue(permission('0'));
    await enableQuickPlay(config, accountId, wallet);
    expect(send.mock.calls[0]![0].actions.map((action: { type: string }) => action.type)).toEqual(['DeleteKey', 'AddKey']);
    expect(send.mock.calls[0]![0].actions[0].params.publicKey).toBe(publicKey);
  });

  it('rejects broad, unlimited, or wrong-contract permissions', async () => {
    store();
    for (const access of [{ nonce: 1, permission: 'FullAccess' }, permission(QUICK_PLAY_ALLOWANCE, []), permission(QUICK_PLAY_ALLOWANCE, [...PLAY_METHODS, 'withdraw']), permission(QUICK_PLAY_ALLOWANCE, [...PLAY_METHODS], 'other.testnet'), permission((BigInt(QUICK_PLAY_ALLOWANCE) + 1n).toString()), { nonce: 1, permission: { FunctionCall: { receiver_id: config.contracts.arena, method_names: [...PLAY_METHODS], allowance: null } } }]) {
      rpc.rpc.getAccessKey.mockResolvedValue(access);
      await expect(quickPlayStatus(config, accountId)).resolves.toMatchObject({ kind: 'missing' });
    }
  });

  it('detects revocation without hiding RPC outages', async () => {
    const publicKey = store();
    rpc.rpc.getAccessKey.mockRejectedValueOnce(new AccessKeyDoesNotExistError(accountId, publicKey));
    await expect(quickPlayStatus(config, accountId)).resolves.toMatchObject({ kind: 'missing' });
    rpc.rpc.getAccessKey.mockRejectedValueOnce(new Error('RPC unavailable'));
    await expect(quickPlayStatus(config, accountId)).rejects.toThrow('RPC unavailable');
  });

  it('handles the modern missing-key cause without treating general network failures as missing keys', async () => {
    store();
    rpc.rpc.getAccessKey.mockRejectedValueOnce(new NetworkError('RPC error [UNKNOWN_ACCESS_KEY]: Server error'));
    await expect(quickPlayStatus(config, accountId)).resolves.toMatchObject({ kind: 'missing', funded: true });
    rpc.rpc.getAccount.mockRejectedValueOnce(new NetworkError('RPC unavailable'));
    await expect(quickPlayStatus(config, accountId)).rejects.toThrow('RPC unavailable');
  });

  it('removes the chain key through the wallet before clearing storage', async () => {
    const publicKey = store();
    rpc.getAccessKey.mockResolvedValue(permission());
    await removeQuickPlay(config, accountId, wallet);
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ receiverId: accountId, actions: [{ type: 'DeleteKey', params: { publicKey } }] }));
    expect(readQuickPlayKey(config.network, accountId)).toBeNull();
  });

  it('retains the key when the player rejects removal', async () => {
    store();
    rpc.getAccessKey.mockResolvedValue(permission());
    send.mockRejectedValueOnce(new Error('Declined'));
    await expect(removeQuickPlay(config, accountId, wallet)).rejects.toThrow('Declined');
    expect(readQuickPlayKey(config.network, accountId)).not.toBeNull();
  });

  it('does not approve a key when browser storage is blocked', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('Storage blocked'); } });
    await expect(enableQuickPlay(config, accountId, wallet)).rejects.toThrow('Storage blocked');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('arena signing routes', () => {
  it('signs an active play key locally with zero deposit and no wallet prompt', async () => {
    store();
    await arenaCall(config, accountId, wallet, 'open_position', { side: 'long' });
    expect(rpc.call).toHaveBeenCalledExactlyOnceWith(config.contracts.arena, 'open_position', { side: 'long' }, { gas: '30 Tgas', attachedDeposit: '0 yocto' });
    expect(vi.mocked(Near).mock.calls.some(([options]) => options && 'privateKey' in options && options.privateKey)).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('falls back to the wallet and publishes status when the key is exhausted', async () => {
    store();
    rpc.rpc.getAccessKey.mockResolvedValue(permission('0'));
    const onStatus = vi.fn();
    await arenaCall(config, accountId, wallet, 'open_position', {}, { onStatus });
    expect(send).toHaveBeenCalledTimes(1);
    expect(rpc.call).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ kind: 'exhausted' }));
  });

  it('falls back when the key is missing or removed', async () => {
    await arenaCall(config, accountId, wallet, 'pick', {});
    expect(send).toHaveBeenCalledTimes(1);
    expect(rpc.call).not.toHaveBeenCalled();
  });

  it('always uses the wallet for money actions and attached deposits', async () => {
    store();
    await arenaCall(config, accountId, wallet, 'withdraw', {});
    await arenaCall(config, accountId, wallet, 'pick', {}, { deposit: '1' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0].actions[0].params.deposit).toBe('1');
    expect(rpc.call).not.toHaveBeenCalled();
  });

  it('does not resend through the wallet after an ambiguous network failure', async () => {
    store();
    rpc.call.mockRejectedValueOnce(new Error('Network timeout'));
    await expect(arenaCall(config, accountId, wallet, 'start_duel', {})).rejects.toThrow('Network timeout');
    expect(send).not.toHaveBeenCalled();
  });

  it('uses the wallet after definite key revocation during local signing', async () => {
    const publicKey = store();
    rpc.rpc.getAccessKey.mockResolvedValueOnce(permission()).mockRejectedValue(new AccessKeyDoesNotExistError(accountId, publicKey));
    rpc.call.mockRejectedValueOnce(new AccessKeyDoesNotExistError(accountId, publicKey));
    const onStatus = vi.fn();
    await arenaCall(config, accountId, wallet, 'open_position', {}, { onStatus });
    expect(send).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith({ kind: 'missing', funded: true });
  });
});
