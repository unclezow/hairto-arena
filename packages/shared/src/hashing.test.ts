import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { keccak_256 } from '@noble/hashes/sha3.js';
import { describe, expect, it } from 'vitest';

import {
  commitHash,
  fromBase64,
  fromHex,
  merkleLeaf,
  seedHash,
  ticketMessage,
  toBase64,
  toHex,
} from './hashing.js';
import { Dir, type BotLevel } from './types.js';

/** Vectors written by the arena contract tests (`src/tests/vectors.rs` and `src/tests/merkle.rs`). */
function vectors<T>(name: string): T {
  const url = new URL(`../../../contracts/arena/tests/vectors/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as T;
}

interface HashVectors {
  commits: { dir: number; salt: string; duel_id: string; player: string; commit: string }[];
  seed_hashes: { seed: string; fighter: string; nonce: string; seed_hash: string }[];
  ticket_messages: {
    arena: string;
    fighter: string;
    asset_id: number;
    bot_level: number;
    seed_hash: string;
    nonce: string;
    deadline_ms: string;
    message: string;
  }[];
}

interface MerkleVectors {
  trees: {
    name: string;
    root: string;
    entries: { account_id: string; amount: string; leaf: string; proof: string[] }[];
  }[];
}

/** Sorted-pair node hash, as the contract's `merkle::verify` folds a proof. */
function fold(leaf: Uint8Array, proof: string[]): string {
  let node = leaf;
  for (const sibling of proof.map(fromHex)) {
    const [a, b] = toHex(node) < toHex(sibling) ? [node, sibling] : [sibling, node];
    const joined = new Uint8Array(64);
    joined.set(a, 0);
    joined.set(b, 32);
    node = keccak_256(joined);
  }
  return toHex(node);
}

describe('hashes.json parity', () => {
  const v = vectors<HashVectors>('hashes.json');

  it('has vectors for every kind', () => {
    expect(v.commits.length).toBeGreaterThan(0);
    expect(v.seed_hashes.length).toBeGreaterThan(0);
    expect(v.ticket_messages.length).toBeGreaterThan(0);
  });

  it.each(v.commits)('commit for $player, duel $duel_id', (c) => {
    const dir = c.dir === 1 ? Dir.Long : Dir.Short;
    expect(toHex(commitHash(dir, fromHex(c.salt), BigInt(c.duel_id), c.player))).toBe(c.commit);
  });

  it.each(v.seed_hashes)('seed hash for $fighter, nonce $nonce', (s) => {
    expect(toHex(seedHash(fromHex(s.seed), s.fighter, BigInt(s.nonce)))).toBe(s.seed_hash);
  });

  it.each(v.ticket_messages)('ticket message for $fighter on $arena', (t) => {
    const message = ticketMessage(t.arena, {
      fighter: t.fighter,
      assetId: t.asset_id,
      botLevel: t.bot_level as BotLevel,
      seedHash: fromHex(t.seed_hash),
      nonce: BigInt(t.nonce),
      deadlineMs: BigInt(t.deadline_ms),
    });
    expect(toHex(message)).toBe(t.message);
  });
});

describe('merkle.json parity', () => {
  const v = vectors<MerkleVectors>('merkle.json');

  it.each(v.trees)('leaves and proofs of $name', (tree) => {
    for (const e of tree.entries) {
      const leaf = merkleLeaf(e.account_id, BigInt(e.amount));
      expect(toHex(leaf)).toBe(e.leaf);
      expect(fold(leaf, e.proof)).toBe(tree.root);
    }
  });
});

describe('input checks and encodings', () => {
  it('rejects a short salt and a missing direction', () => {
    expect(() => commitHash(Dir.Long, new Uint8Array(31), 1, 'a.testnet')).toThrow('salt');
    expect(() => commitHash(Dir.None as Dir.Long, new Uint8Array(32), 1, 'a.testnet')).toThrow('dir');
  });

  it('round-trips base64 and hex', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 254, 255]);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    expect(fromHex(toHex(bytes))).toEqual(bytes);
    expect(toBase64(new Uint8Array(32).fill(9))).toBe(Buffer.alloc(32, 9).toString('base64'));
    expect(() => fromHex('abc')).toThrow('invalid hex');
  });
});
