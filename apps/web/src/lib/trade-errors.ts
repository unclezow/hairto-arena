/** A transaction whose fate is unknown (timeout or network error after sending). */
const UNKNOWN_FATE = /timeout|timed out|network|fetch failed|ECONN|503|504/i;

/** Short, visible reason for a failed transaction, from the arena panic text. */
export function reasonOf(err: unknown) {
  const text = (err as Error)?.message ?? '';
  for (const [needle, reason] of [
    ['NotEnoughAllowance', 'QUICK PLAY OUT OF GAS ALLOWANCE'],
    ['hold too short', 'HOLD 3s FIRST'],
    ['price stale', 'PRICE FEED STALE'],
    ['round not open', 'ROUND NOT OPEN'],
    ['reveal window closed', 'REVEAL WINDOW CLOSED'],
    ['trade limit reached', 'NO TRADES LEFT'],
    ['position already open', 'POSITION ALREADY OPEN'],
    ['no tick at round end', 'PRICE FEED STALE'],
    ['reject', 'REJECTED IN WALLET'],
  ] as const) {
    if (text.toLowerCase().includes(needle.toLowerCase())) return reason;
  }
  return UNKNOWN_FATE.test(text) ? 'NOT CONFIRMED YET' : 'TRANSACTION FAILED';
}
