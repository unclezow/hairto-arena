import { env } from './env';
import { getSessionToken, renewSession, sessionSnapshot } from './session';

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) { super(message); }
}

async function request(path: string, init: RequestInit | undefined, token: string | null) {
  const headers = new Headers(init?.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  return fetch(`${env.apiUrl}/api/v1${path}`, { ...init, headers });
}

/** TanStack Query calls this wrapper; a 401 renews once and retries for the same account. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const originalToken = getSessionToken();
  const originalAccount = sessionSnapshot().accountId;
  let response = await request(path, init, originalToken);
  if (response.status === 401 && originalAccount === sessionSnapshot().accountId && !path.startsWith('/auth/') && !init?.signal?.aborted) {
    const token = await renewSession();
    if (token && originalAccount === sessionSnapshot().accountId && !init?.signal?.aborted) response = await request(path, init, token);
  }
  if (!response.ok) {
    const text = await response.text();
    let body: { error?: { code?: string; message?: string } } = {};
    try { body = JSON.parse(text) as typeof body; } catch { /* Non-JSON server response. */ }
    throw new ApiError(response.status, body.error?.message ?? text, body.error?.code);
  }
  return (response.status === 204 ? undefined : response.json()) as Promise<T>;
}
