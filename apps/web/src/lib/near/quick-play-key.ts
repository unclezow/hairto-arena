import { AccessKeyDoesNotExistError, AccountDoesNotExistError, Near, NearError, NetworkError, generateKey, parseKey } from 'near-kit';
import type { PrivateKey } from 'near-kit';
import type { NearWalletBase } from '@hot-labs/near-connect';
import type { NearConfig } from './config';
import { viewClient } from './client';
import { transactionCompleted } from './transactions';

export const PLAY_METHODS = ['start_duel', 'open_position', 'close_position', 'settle_duel', 'pick'] as const;
export const QUICK_PLAY_ALLOWANCE = '250000000000000000000000';
interface BrowserKey { publicKey: string; secretKey: PrivateKey }
export type QuickPlayStatus =
  | { kind: 'missing'; funded: boolean }
  | { kind: 'active' | 'exhausted'; funded: true; publicKey: string; allowance: string };
const storageKey = (network: string, accountId: string) => `hairto:quick-play:${network}:${accountId}`;

async function accountExists(near: Near, accountId: string) {
  try { await near.rpc.getAccount(accountId); return true; }
  catch (error) { if (error instanceof AccountDoesNotExistError) return false; throw error; }
}

async function accessKey(near: Near, accountId: string, publicKey: string) {
  try { return await near.rpc.getAccessKey(accountId, publicKey); }
  catch (error) { if (missingAccessKey(error) || error instanceof AccountDoesNotExistError) return null; throw error; }
}

function missingAccessKey(error: unknown) {
  // near-kit 0.20.2 maps result.error but leaves this modern RPC cause as NetworkError.
  return error instanceof AccessKeyDoesNotExistError || (error instanceof NetworkError && error.message.startsWith('RPC error [UNKNOWN_ACCESS_KEY]:'));
}

export function readQuickPlayKey(network: string, accountId: string): BrowserKey | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(network, accountId)) ?? 'null');
    if (!parsed || typeof parsed !== 'object' || !('secretKey' in parsed) || typeof parsed.secretKey !== 'string' || !parsed.secretKey.startsWith('ed25519:')) return null;
    const pair = parseKey(parsed.secretKey);
    if (!('publicKey' in parsed) || pair.publicKey.toString() !== parsed.publicKey) return null;
    return { publicKey: parsed.publicKey as string, secretKey: pair.secretKey as PrivateKey };
  } catch { return null; }
}

function getOrCreateKey(network: string, accountId: string): BrowserKey {
  const stored = readQuickPlayKey(network, accountId);
  if (stored) return stored;
  const pair = generateKey();
  const key = { publicKey: pair.publicKey.toString(), secretKey: pair.secretKey as PrivateKey };
  // Persist before asking for AddKey. If storage is blocked, do not approve an unremembered key.
  localStorage.setItem(storageKey(network, accountId), JSON.stringify(key));
  return key;
}

export async function quickPlayStatus(config: NearConfig, accountId: string, near = viewClient(config)): Promise<QuickPlayStatus> {
  if (!await accountExists(near, accountId)) return { kind: 'missing', funded: false };
  const key = readQuickPlayKey(config.network, accountId);
  if (!key) return { kind: 'missing', funded: true };
  let access;
  try { access = await near.rpc.getAccessKey(accountId, key.publicKey); }
  catch (error) {
    if (missingAccessKey(error)) return { kind: 'missing', funded: true };
    if (error instanceof AccountDoesNotExistError) return { kind: 'missing', funded: false };
    throw error;
  }
  const permission = typeof access.permission === 'object' && 'FunctionCall' in access.permission ? access.permission.FunctionCall : null;
  if (!permission || permission.receiver_id !== config.contracts.arena || permission.method_names.length !== PLAY_METHODS.length || !PLAY_METHODS.every((method) => permission.method_names.includes(method)) || permission.allowance == null || BigInt(permission.allowance) > BigInt(QUICK_PLAY_ALLOWANCE)) {
    return { kind: 'missing', funded: true };
  }
  return { kind: BigInt(permission.allowance) > 0n ? 'active' : 'exhausted', funded: true, publicKey: key.publicKey, allowance: permission.allowance };
}

export async function enableQuickPlay(config: NearConfig, accountId: string, wallet: NearWalletBase, near = viewClient(config)) {
  if (!await accountExists(near, accountId)) throw new Error('Fund your account with testnet NEAR before enabling quick play.');
  const key = getOrCreateKey(config.network, accountId);
  const current = await quickPlayStatus(config, accountId, near);
  if (current.kind === 'active') return current;
  const access = current.kind === 'missing' ? await accessKey(near, accountId, key.publicKey) : true;
  // Replace an exhausted or incompatible key atomically, without leaving it on the account.
  await wallet.signAndSendTransaction({
    signerId: accountId, receiverId: accountId, network: config.network,
    actions: [
      ...(access ? [{ type: 'DeleteKey' as const, params: { publicKey: key.publicKey } }] : []),
      { type: 'AddKey', params: { publicKey: key.publicKey, accessKey: { nonce: 0, permission: { receiverId: config.contracts.arena, methodNames: [...PLAY_METHODS], allowance: QUICK_PLAY_ALLOWANCE } } } },
    ],
  });
  transactionCompleted();
  return quickPlayStatus(config, accountId, near);
}

export async function removeQuickPlay(config: NearConfig, accountId: string, wallet: NearWalletBase, near = viewClient(config)) {
  const key = readQuickPlayKey(config.network, accountId);
  if (!key) return;
  if (await accessKey(near, accountId, key.publicKey)) {
    await wallet.signAndSendTransaction({ signerId: accountId, receiverId: accountId, network: config.network, actions: [{ type: 'DeleteKey', params: { publicKey: key.publicKey } }] });
  }
  transactionCompleted();
  localStorage.removeItem(storageKey(config.network, accountId));
  localClients.delete(`${config.network}:${accountId}:${key.publicKey}`);
}

const localClients = new Map<string, Near>();
function localClient(config: NearConfig, accountId: string, key: BrowserKey) {
  const id = `${config.network}:${accountId}:${key.publicKey}`;
  let client = localClients.get(id);
  if (!client) {
    client = new Near({ network: config.network, rpcUrl: config.rpcUrl, privateKey: key.secretKey, defaultSignerId: accountId });
    localClients.set(id, client);
  }
  return client;
}

/** Only definite access-key rejection can be retried through another signer. */
function keyRejected(error: unknown) {
  if (missingAccessKey(error)) return true;
  if (!(error instanceof NearError) || error.code !== 'INVALID_TRANSACTION') return false;
  const details = (error as NearError & { details?: unknown }).details ?? error.data;
  if (!details || typeof details !== 'object' || !('InvalidAccessKeyError' in details)) return false;
  const reason = details.InvalidAccessKeyError;
  return !!reason && typeof reason === 'object' && ('NotEnoughAllowance' in reason || 'AccessKeyNotFound' in reason);
}

export interface ArenaCallOptions { deposit?: string; /** Prepaid gas in Tgas (default 30). */ gasTgas?: number; onStatus?: (status: QuickPlayStatus) => void }
/** Money actions and non-play methods always use the connected wallet. Deposits are yoctoNEAR. */
export async function arenaCall(config: NearConfig, accountId: string, wallet: NearWalletBase, method: string, args: object, options: ArenaCallOptions = {}) {
  const deposit = options.deposit ?? '0';
  const gasTgas = options.gasTgas ?? 30;
  const eligible = (PLAY_METHODS as readonly string[]).includes(method) && BigInt(deposit) === 0n;
  const status = eligible ? await quickPlayStatus(config, accountId) : null;
  if (status) options.onStatus?.(status);
  if (status?.kind === 'active') {
    const key = readQuickPlayKey(config.network, accountId);
    if (key) {
      try {
        const result = await localClient(config, accountId, key).call(config.contracts.arena, method, args, { gas: `${gasTgas} Tgas`, attachedDeposit: '0 yocto' });
        transactionCompleted();
        // A failed refresh must not turn an already-sent transaction into a wallet retry.
        void quickPlayStatus(config, accountId).then((next) => options.onStatus?.(next)).catch(() => undefined);
        return result;
      } catch (error) {
        if (!keyRejected(error)) throw error;
        const next = await quickPlayStatus(config, accountId);
        options.onStatus?.(next);
      }
    }
  }
  const result = await wallet.signAndSendTransaction({ signerId: accountId, receiverId: config.contracts.arena, network: config.network, actions: [{ type: 'FunctionCall', params: { methodName: method, args, gas: (BigInt(gasTgas) * 1_000_000_000_000n).toString(), deposit } }] });
  transactionCompleted();
  if (eligible) void quickPlayStatus(config, accountId).then((next) => options.onStatus?.(next)).catch(() => undefined);
  return result;
}
