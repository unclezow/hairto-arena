import hashes from '../../../../contracts/arena/tests/vectors/hashes.json' with { type: 'json' };
import {
  generateSeed,
  hashSeed,
  normalizeSeed,
  seedToBase64,
  seededRandom,
  verifySeed,
} from './seed.js';

const FIGHTER = 'fighter.testnet';

describe('bot seed', () => {
  it('verifies a revealed seed against its commitment', () => {
    const seed = generateSeed();
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    const hash = hashSeed(seed, FIGHTER, 3n);
    expect(verifySeed(seed, FIGHTER, 3n, hash)).toBe(true);
    expect(verifySeed(generateSeed(), FIGHTER, 3n, hash)).toBe(false);
    expect(verifySeed(seed, FIGHTER, 4n, hash)).toBe(false);
    expect(verifySeed(seed, 'other.testnet', 3n, hash)).toBe(false);
  });

  it('matches the arena: sha256(borsh((seed, fighter, nonce)))', () => {
    for (const v of hashes.seed_hashes) {
      const expected = Buffer.from(v.seed_hash, 'hex').toString('base64');
      expect(hashSeed(v.seed, v.fighter, BigInt(v.nonce))).toBe(expected);
    }
  });

  it('converts between hex and base64', () => {
    const seed = 'ab'.repeat(32);
    expect(normalizeSeed(seedToBase64(seed))).toBe(seed);
    expect(normalizeSeed(seed.toUpperCase())).toBe(seed);
    expect(() => normalizeSeed('AAAA')).toThrow('32 bytes');
  });

  it('replays the same random sequence from the same seed', () => {
    const seed = generateSeed();
    const a = seededRandom(seed);
    const b = seededRandom(seed);
    const seqA = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(seqA);
    for (const n of seqA) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });
});
