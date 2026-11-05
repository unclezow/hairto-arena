import { fromBase64, fromHex, seedHash, toBase64, toHex } from '@hairto-arena/shared';
import { keccak_256 } from '@noble/hashes/sha3.js';

/** A bot seed: 32 bytes as 64 lowercase hex characters. */
export type Seed = string;

/**
 * Bot seed commit-reveal. The seed ticket carries `hashSeed(seed, fighter, nonce)` and the bot reveals `seed` after
 * the duel ends, so anyone can replay the bot's decisions with `seededRandom(seed)`. Must match the arena's check
 * in `reveal_bot_seed`: sha256(borsh((seed, fighter, nonce))). The fighter and nonce are known before the duel.
 */
export function generateSeed(): Seed {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** Base64 seed hash, as the ticket and the arena carry it. */
export function hashSeed(seed: Seed, fighter: string, nonce: bigint | number): string {
  return toBase64(seedHash(fromHex(seed), fighter, nonce));
}

export function verifySeed(
  seed: Seed,
  fighter: string,
  nonce: bigint | number,
  seedHashB64: string,
): boolean {
  return hashSeed(seed, fighter, nonce) === seedHashB64;
}

/** Base64 form of a seed, for `reveal_bot_seed`. */
export function seedToBase64(seed: Seed): string {
  return toBase64(fromHex(seed));
}

/** Accepts a seed as 64 hex characters or as base64 of 32 bytes, and returns the hex form. */
export function normalizeSeed(value: string): Seed {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return value.toLowerCase();
  const bytes = fromBase64(value);
  if (bytes.length !== 32) throw new Error('A seed is 32 bytes');
  return toHex(bytes);
}

/** Deterministic PRNG in [0, 1) derived from the seed (mulberry32 over the first 4 bytes of keccak(seed)). */
export function seededRandom(seed: Seed): () => number {
  let state = Buffer.from(keccak_256(fromHex(seed))).readUInt32BE(0) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` as 32 big-endian bytes. */
export function uint256(n: number | bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = BigInt(n);
  for (let i = 31; i >= 0 && v > 0n; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
