/** Result navigation markers only; near-web-duel owns NEAR ticket and reveal state. */
const resultKey = (duelId: string) => `duel:${duelId}:result-from-arena`;
export function markResultFromArena(duelId: string) {
  try { sessionStorage.setItem(resultKey(duelId), 'true'); } catch { /* Storage may be blocked. */ }
}
export function takeResultFromArena(duelId: string) {
  try {
    const fromArena = sessionStorage.getItem(resultKey(duelId)) === 'true';
    sessionStorage.removeItem(resultKey(duelId));
    return fromArena;
  } catch { return false; }
}
