'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { NearConnector } from '@hot-labs/near-connect';
import { getConnector, watchConnection, type WalletConnection } from './connector';
import { fallbackConfig, loadNearConfig, type NearConfig } from './config';
import { setWalletSessionConnection } from '../wallet-auth';
import { configureExplorer } from '../explorer';

interface NearContextValue extends WalletConnection {
  config: NearConfig;
  connector: NearConnector | null;
  error: string | null;
}
const NearContext = createContext<NearContextValue | null>(null);

export function NearProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NearContextValue>(() => ({
    config: fallbackConfig(), connector: null, accountId: null, wallet: null, error: null,
  }));
  useEffect(() => {
    const controller = new AbortController();
    let stop: (() => void) | undefined;
    void loadNearConfig(controller.signal).then(async (config) => {
      configureExplorer(config.explorerUrl);
      // The isolated signing popup does not need another wallet selector instance.
      if (window.location.pathname === '/sign') return;
      const connector = await getConnector(config);
      if (controller.signal.aborted) return;
      setState((previous) => ({ ...previous, config, connector, error: null }));
      stop = watchConnection(connector, (connection) => {
        setWalletSessionConnection(connection.wallet && connection.accountId ? { wallet: connection.wallet, accountId: connection.accountId } : null);
        setState((previous) => ({ ...previous, ...connection }));
      });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState((previous) => ({ ...previous, error: error instanceof Error ? error.message : 'Wallet connection failed.' }));
    });
    return () => { controller.abort(); stop?.(); };
  }, []);
  return <NearContext.Provider value={state}>{children}</NearContext.Provider>;
}

export function useNearWallet() {
  const value = useContext(NearContext);
  if (!value) throw new Error('NEAR wallet hooks require NearProvider.');
  return value;
}
