import { fromBase64, seedHash, toBase64 } from '@hairto-arena/shared';

export type SeedAudit = 'match' | 'mismatch';

/**
 * Recomputes `seedHash(seed, fighter, nonce)` from the revealed bot seed and compares it with the hash the bot
 * committed in the seed ticket. Runs in the browser, so the player does not have to trust the API's own check.
 */
export function auditSeed(seedB64: string, fighter: string, nonce: number | bigint, committedB64: string): SeedAudit {
  try {
    const seed = fromBase64(seedB64);
    if (seed.length !== 32) return 'mismatch';
    return toBase64(seedHash(seed, fighter, nonce)) === committedB64 ? 'match' : 'mismatch';
  } catch {
    return 'mismatch';
  }
}
