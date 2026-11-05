import type { NearConnector, NearWalletBase, WalletManifest } from '@hot-labs/near-connect';
import type { NearConfig } from './config';

export interface WalletConnection {
  wallet: NearWalletBase | null;
  accountId: string | null;
}

const disconnected: WalletConnection = { wallet: null, accountId: null };

/** The SDK keeps its default wallets; the app registers Privy as one additional wallet. */
export async function registerPrivy(connector: NearConnector, origin: string) {
  const response = await fetch('/manifest.json');
  if (!response.ok) throw new Error('Could not load the Privy wallet manifest.');
  const manifest = await response.json() as { wallets: (WalletManifest & { metadata: { signPageURL: string } })[] };
  const wallet = manifest.wallets.find((entry) => entry.id === 'hairto-privy');
  if (!wallet || !/^https:\/\/raw\.githubusercontent\.com\/beneviolabs\/privy-near-connect\/[a-f0-9]{40}\/executor\.js$/.test(wallet.executor)) {
    throw new Error('Privy executor must be pinned to an immutable commit.');
  }
  wallet.website = origin;
  wallet.icon = `${origin}/play/currencies/near-token.png`;
  wallet.permissions.allowsOpen = [origin];
  wallet.metadata.signPageURL = `${origin}/sign`;
  await connector.whenManifestLoaded;
  await connector.registerWallet(wallet);
}

/** Subscribe before restoring; SDK restore reads existing accounts without opening a selector. */
export function watchConnection(connector: NearConnector, notify: (value: WalletConnection) => void) {
  let active = true;
  let revision = 0;
  const signIn = (event: { success: boolean; wallet: NearWalletBase; accounts: { accountId: string }[] }) => {
    revision++;
    if (active && event.success) notify({ wallet: event.wallet, accountId: event.accounts[0]?.accountId ?? null });
  };
  const signOut = () => {
    revision++;
    if (active) notify(disconnected);
  };
  connector.on('wallet:signIn', signIn);
  connector.on('wallet:signOut', signOut);
  const started = revision;
  void connector.getConnectedWallet().then(({ wallet, accounts }) => {
    if (active && started === revision) notify({ wallet, accountId: accounts[0]?.accountId ?? null });
  }).catch(() => {
    if (active && started === revision) notify(disconnected);
  });
  return () => {
    active = false;
    connector.off('wallet:signIn', signIn);
    connector.off('wallet:signOut', signOut);
  };
}

let instance: Promise<NearConnector> | null = null;
export function getConnector(config: NearConfig): Promise<NearConnector> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Wallet connection requires a browser.'));
  instance ??= import('@hot-labs/near-connect').then(async ({ NearConnector }) => {
    const connector = new NearConnector({
      network: config.network,
      autoConnect: false,
      providers: { testnet: [config.rpcUrl] },
      features: { signMessage: true, signAndSendTransaction: true, signAndSendTransactions: true },
    });
    await registerPrivy(connector, window.location.origin);
    return connector;
  }).catch((error: unknown) => {
    instance = null;
    throw error;
  });
  return instance;
}
