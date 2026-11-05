'use client';

import { useCallback } from 'react';
import { useNearWallet } from '@/lib/near/context';
import { requestSignIn, setSignInState } from '@/lib/session';
import { describeSignInError, setWalletSessionConnection } from '@/lib/wallet-auth';

export function useLogin() {
  const { connector, error } = useNearWallet();
  return useCallback(async () => {
    if (!connector) { setSignInState('failed', error ?? 'Wallets are still loading. Try again.'); return; }
    requestSignIn();
    try { await connector.connect(); }
    catch (reason) { setSignInState('failed', describeSignInError(reason)); }
  }, [connector, error]);
}

export function useLogout() {
  const { connector, wallet } = useNearWallet();
  return useCallback(async () => {
    setWalletSessionConnection(null);
    if (connector && wallet) await connector.disconnect(wallet);
  }, [connector, wallet]);
}
