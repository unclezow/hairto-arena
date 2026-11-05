/** API session: memory plus per-account tab storage, with exact account-id comparison. */
export interface StoredSession { token: string; accountId: string }
export type SignInStatus = 'idle' | 'signing' | 'failed';
export interface SessionSnapshot { accountId: string | null; token: string | null; status: SignInStatus; error: string | null }
const empty: SessionSnapshot = { accountId: null, token: null, status: 'idle', error: null };
let snapshot = empty;
let signInRequested = false;
let renew: (() => Promise<string | null>) | null = null;
const listeners = new Set<() => void>();
const storageKey = (accountId: string) => `hairto:session:${accountId}`;

function update(next: SessionSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export const subscribeSession = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const sessionSnapshot = () => snapshot;
export const serverSessionSnapshot = () => empty;
export function requestSignIn() { signInRequested = true; }
export function takeSignInRequest() { const requested = signInRequested; signInRequested = false; return requested; }

export function setActiveAccount(accountId: string | null) {
  if (accountId === snapshot.accountId) return;
  setSession(null);
  let token: string | null = null;
  if (accountId) {
    try {
      const value: unknown = JSON.parse(sessionStorage.getItem(storageKey(accountId)) ?? 'null');
      if (value && typeof value === 'object' && 'accountId' in value && value.accountId === accountId && 'token' in value && typeof value.token === 'string') token = value.token;
    } catch { /* Storage may be blocked or malformed. */ }
  }
  update({ accountId, token, status: 'idle', error: null });
}

export function getSessionToken(accountId?: string): string | null {
  if (accountId !== undefined && accountId !== snapshot.accountId) return null;
  return snapshot.token;
}

export function setSession(session: StoredSession | null) {
  if (session && session.accountId !== snapshot.accountId) return;
  const accountId = snapshot.accountId;
  try {
    if (session) sessionStorage.setItem(storageKey(session.accountId), JSON.stringify(session));
    else if (accountId) sessionStorage.removeItem(storageKey(accountId));
  } catch { /* In-memory sessions still work when storage is blocked. */ }
  update({ ...snapshot, token: session?.token ?? null });
}

export function setSignInState(status: SignInStatus, error: string | null = null) {
  update({ ...snapshot, status, error });
}
export function setSessionRenewer(fn: (() => Promise<string | null>) | null) { renew = fn; }
export function renewSession(): Promise<string | null> { return renew ? renew() : Promise.resolve(null); }
