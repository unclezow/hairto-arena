import { seedHash, toBase64 } from '@hairto-arena/shared';
import { describe, expect, it } from 'vitest';
import { auditSeed } from './seed-audit';

const seed = new Uint8Array(32).map((_, i) => i + 1);
const committed = toBase64(seedHash(seed, 'fighter.testnet', 7));

describe('seed audit', () => {
  it('matches an honest reveal', () => {
    expect(auditSeed(toBase64(seed), 'fighter.testnet', 7, committed)).toBe('match');
  });
  it('rejects another seed, fighter or nonce', () => {
    const other = new Uint8Array(32).fill(9);
    expect(auditSeed(toBase64(other), 'fighter.testnet', 7, committed)).toBe('mismatch');
    expect(auditSeed(toBase64(seed), 'other.testnet', 7, committed)).toBe('mismatch');
    expect(auditSeed(toBase64(seed), 'fighter.testnet', 8, committed)).toBe('mismatch');
  });
  it('rejects malformed input', () => {
    expect(auditSeed('not base64!', 'fighter.testnet', 7, committed)).toBe('mismatch');
    expect(auditSeed(toBase64(new Uint8Array(4)), 'fighter.testnet', 7, committed)).toBe('mismatch');
  });
});
