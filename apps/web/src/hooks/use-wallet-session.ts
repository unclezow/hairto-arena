'use client';

import { useSyncExternalStore } from 'react';
import { useNearWallet } from '@/lib/near/context';
import { serverSessionSnapshot, sessionSnapshot, subscribeSession } from '@/lib/session';
import { signIn } from '@/lib/wallet-auth';

export const lastSignInError = () => sessionSnapshot().error;

export function useWalletSession() {
  const { accountId, wallet } = useNearWallet();
  const snapshot = useSyncExternalStore(subscribeSession, sessionSnapshot, serverSessionSnapshot);
  return {
    accountId,
    isConnected: !!accountId && !!wallet,
    embedded: wallet?.manifest.id === 'hairto-privy',
    token: snapshot.accountId === accountId ? snapshot.token : null,
    status: snapshot.status,
    error: snapshot.error,
    signIn,
  };
}
