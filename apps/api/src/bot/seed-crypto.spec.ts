import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSeed, encryptSeed, isEncryptedSeed } from './seed-crypto.js';
import { generateSeed } from './seed.js';

const key = randomBytes(32);

describe('seed encryption', () => {
  it('round trips a seed and never stores it in clear', () => {
    const seed = generateSeed();
    const stored = encryptSeed(seed, key);
    expect(isEncryptedSeed(stored)).toBe(true);
    expect(stored).not.toContain(seed);
    expect(decryptSeed(stored, key)).toBe(seed);
  });

  it('uses a fresh IV, so the same seed encrypts differently each time', () => {
    const seed = generateSeed();
    expect(encryptSeed(seed, key)).not.toBe(encryptSeed(seed, key));
  });

  it('rejects a tampered value and a wrong key', () => {
    const stored = encryptSeed(generateSeed(), key);
    const flipped = stored.slice(0, -2) + (stored.endsWith('00') ? '01' : '00');
    expect(() => decryptSeed(flipped, key)).toThrow();
    expect(() => decryptSeed(stored, randomBytes(32))).toThrow();
  });

  it('passes a revealed (plain) seed through, as hex or base64', () => {
    const seed = generateSeed();
    expect(isEncryptedSeed(seed)).toBe(false);
    expect(decryptSeed(seed, key)).toBe(seed);
    expect(decryptSeed(Buffer.from(seed, 'hex').toString('base64'), key)).toBe(seed);
  });
});
