'use client';

import { useCallback, useState } from 'react';
import { useLogin, useLogout } from '@/hooks/use-login';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { useBalances } from '@/hooks/use-balances';
export { shortAddress } from '@/hooks/use-lobby-data';

export function revertText(error: unknown) { return error instanceof Error ? error.message.split('\n')[0]! : 'Transaction failed'; }
/**
 * Runs one player action and keeps its message. `action` returns an error text when the contracts refused it
 * (read from their events), or null on success; a thrown error is shown as its first line.
 */
export function useTx() {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = useCallback(async (label: string, action: () => Promise<string | null>) => {
    setBusy(label);
    setMessage(null);
    try {
      const problem = await action();
      setMessage(problem ? { ok: false, text: `${label}: ${problem}` } : { ok: true, text: `${label}: done` });
      return !problem;
    } catch (error) {
      setMessage({ ok: false, text: `${label}: ${revertText(error)}` });
      return false;
    } finally {
      setBusy(null);
    }
  }, []);
  return { busy, message, run };
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
