import Privy, { LocalStorage, create } from '@privy-io/js-sdk-core';
import { env } from '../env';

let client: Promise<Privy> | null = null;
export function getPrivy(): Promise<Privy> {
  if (!env.privyAppId || !env.privyClientId) {
    return Promise.reject(new Error('Configure the public Privy App ID and Client ID to use social login.'));
  }
  client ??= (async () => {
    const instance = new Privy({ appId: env.privyAppId, clientId: env.privyClientId, storage: new LocalStorage() });
    await instance.initialize();
    return instance;
  })().catch((error: unknown) => { client = null; throw error; });
  return client;
}

const walletRequests = new WeakMap<Privy, Promise<void>>();
export function ensurePrivyNearWallet(privy: Privy): Promise<void> {
  const current = walletRequests.get(privy);
  if (current) return current;
  const pending = (async () => {
    const { user } = await privy.user.get();
    if (user.linked_accounts.some((account) => account.type === 'wallet' && account.chain_type === 'near')) return;
    await create({
      fetchPrivyRoute: privy.fetchPrivyRoute.bind(privy),
      getCompiledPath: privy.getCompiledPath.bind(privy),
      app: { appId: privy.app.appId },
    }, { request: { chain_type: 'near' } });
    const { user: refreshed } = await privy.user.get();
    if (!refreshed.linked_accounts.some((account) => account.type === 'wallet' && account.chain_type === 'near')) {
      throw new Error('Your NEAR wallet is not ready yet. Try again.');
    }
  })().finally(() => walletRequests.delete(privy));
  walletRequests.set(privy, pending);
  return pending;
}

/** One exact origin, never a wildcard or a value supplied by the requesting page. */
export function signingOrigin(origin: string) {
  const configured = env.appOrigin || origin;
  const url = new URL(configured);
  if (url.origin !== configured || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Configure a valid app origin for signing.');
  }
  return configured;
}
