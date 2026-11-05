import type { Dir } from '@hairto-arena/shared';

/**
 * Per-duel browser state. The open position's direction and salt never leave the browser until the reveal, and
 * they live in `localStorage` so a reload or a new tab can still reveal inside the grace window.
 */
export interface StoredPosition {
  dir: Dir.Long | Dir.Short;
  /** Base64 of the 32-byte salt. */
  salt: string;
  /** Local ms when the open transaction was sent, for the minimum hold guard. */
  openedAt: number;
}

const positionKey = (accountId: string, duelId: string) => `duel:${accountId}:${duelId}:position`;
const resultFromKey = (duelId: string) => `duel:${duelId}:result-from-arena`;

function get<T>(storage: () => Storage, key: string): T | null {
  try {
    const raw = storage().getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function put(storage: () => Storage, key: string, value: unknown) {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the duel can still be played from this page.
  }
}

const local = () => localStorage;
const session = () => sessionStorage;

export const loadPosition = (accountId: string, duelId: string) =>
  get<StoredPosition>(local, positionKey(accountId, duelId));
export const savePosition = (accountId: string, duelId: string, position: StoredPosition | null) =>
  put(local, positionKey(accountId, duelId), position);

/** The arena sends the player to the result page; "back" from there goes to the lobby, not into the finished arena. */
export const markResultFromArena = (duelId: string) => put(session, resultFromKey(duelId), true);
export function takeResultFromArena(duelId: string): boolean {
  const from = get<boolean>(session, resultFromKey(duelId)) === true;
  put(session, resultFromKey(duelId), null);
  return from;
}
