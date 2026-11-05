'use client';

import { useState } from 'react';
import { useLogin, useLogout } from '@/hooks/use-login';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { useBalances } from '@/hooks/use-balances';
import { featureReady } from '@/lib/features';
export { shortAddress } from '@/hooks/use-lobby-data';

export function revertText(error: unknown) { return error instanceof Error ? error.message.split('\n')[0]! : 'Transaction failed'; }
/** near-web-economy replaces this transaction fence. It never reports a simulated success. */
export function useTx() {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return {
    busy: null as string | null,
    message,
    run: async (label: string) => { void featureReady('economy'); setMessage({ ok: false, text: `${label}: Economy actions are not available yet.` }); return false; },
  };
}
export function WalletBar() {
  const { accountId, isConnected, token, status, error, signIn } = useWalletSession();
  const login = useLogin();
  const logout = useLogout();
  const balances = useBalances();
  return <div className="flex flex-wrap items-center gap-3 rounded border border-white/15 p-3 text-sm">
    {!isConnected ? <button type="button" className="rounded bg-white px-3 py-1 text-black" onClick={() => void login()}>Connect wallet</button> : <>
      <span className="font-mono">{accountId}</span>
      {token ? <><span className="text-emerald-300">signed in</span><span>{balances.nearText} NEAR (gas) · {balances.usdcText} USDC (mock)</span></> : <button type="button" className="rounded bg-white px-3 py-1 text-black" disabled={status === 'signing'} onClick={() => void signIn()}>{status === 'signing' ? 'Signing…' : 'Sign in'}</button>}
      <button type="button" className="underline" onClick={() => void logout()}>Disconnect</button>
    </>}
    {error && <span className="text-red-300">{error}</span>}
  </div>;
}
export function TxMessage({ tx }: { tx: { busy: string | null; message: { ok: boolean; text: string } | null } }) {
  if (tx.busy) return <p className="text-sm text-white/60">{tx.busy}…</p>;
  if (!tx.message) return null;
  return <p className={`text-sm ${tx.message.ok ? 'text-emerald-300' : 'text-red-300'}`}>{tx.message.text}</p>;
}
