import type { NearWalletBase } from '@hot-labs/near-connect';
import { api, ApiError } from './api';
import { setActiveAccount, setSession, setSessionRenewer, setSignInState, takeSignInRequest } from './session';

interface Connection { accountId: string; wallet: NearWalletBase }
interface Challenge { message: string; recipient: string; nonce: string }
interface Verified { token: string; accountId: string }
let connection: Connection | null = null;
let generation = 0;
let inflight: { accountId: string; generation: number; promise: Promise<string | null> } | null = null;

export function describeSignInError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return 'Cannot reach the game server. Is the API running?';
  const reason = error as { name?: string; code?: number; message?: string } | null;
  if (reason?.code === 4001 || /reject|declin|cancel|closed/i.test(reason?.message ?? '') || reason?.name === 'UserRejectedRequestError') return 'Signature declined';
  return `Sign-in failed: ${(reason?.message ?? 'Unknown error').split('\n')[0]}`;
}

export function setWalletSessionConnection(next: Connection | null) {
  if (next?.accountId === connection?.accountId && next?.wallet === connection?.wallet) return;
  generation++;
  connection = next;
  setActiveAccount(next?.accountId ?? null);
  setSessionRenewer(next ? () => { setSession(null); return signIn(); } : null);
  if (next && takeSignInRequest()) void signIn();
}

/** Single in-flight NEP-413 exchange per page, including renewal and multiple hook users. */
export function signIn(): Promise<string | null> {
  const target = connection;
  if (!target) return Promise.resolve(null);
  if (inflight) {
    if (inflight.accountId === target.accountId && inflight.generation === generation) return inflight.promise;
    return inflight.promise.then(() => connection === target ? signIn() : null);
  }
  const started = generation;
  const current = () => started === generation && connection === target;
  setSignInState('signing');
  const promise = (async () => {
    try {
      const challenge = await api<Challenge>('/auth/nonce', { method: 'POST', body: JSON.stringify({ accountId: target.accountId }) });
      if (!current()) return null;
      const nonce = Uint8Array.from(atob(challenge.nonce), (character) => character.charCodeAt(0));
      if (nonce.length !== 32) throw new Error('The server sent an invalid signing nonce.');
      const signed = await target.wallet.signMessage({ message: challenge.message, recipient: challenge.recipient, nonce, network: 'testnet', signerId: target.accountId });
      if (!current()) return null;
      if (signed.accountId !== target.accountId) throw new Error('Your wallet signed with a different account.');
      const verified = await api<Verified>('/auth/verify', { method: 'POST', body: JSON.stringify({ accountId: target.accountId, publicKey: signed.publicKey, signature: signed.signature }) });
      if (!current()) return null;
      if (verified.accountId !== target.accountId || !verified.token) throw new Error('The server returned a session for a different account.');
      setSession(verified);
      setSignInState('idle');
      return verified.token;
    } catch (error) {
      if (current()) { setSession(null); setSignInState('failed', describeSignInError(error)); }
      return null;
    } finally {
      inflight = null;
    }
  })();
  inflight = { accountId: target.accountId, generation: started, promise };
  return promise;
}
