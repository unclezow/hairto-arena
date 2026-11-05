import { fromHex, merkleLeaf, toHex } from '@hairto-arena/shared';
import { SimpleMerkleTree } from '@openzeppelin/merkle-tree';

/** The root of an empty list: the arena posts it with a zero total, and it never verifies. */
export const EMPTY_ROOT = '00'.repeat(32);

export interface Entry {
  /** NEAR account id. */
  address: string;
  amount: bigint;
}

export interface BuiltTree {
  /** 64 hex characters. */
  root: string;
  /** Proof per account, each node 64 hex characters. */
  proofs: Map<string, string[]>;
}

/** OpenZeppelin's tree library speaks 0x-prefixed hex; everything here is plain hex. */
const ozHex = (bytes: Uint8Array) => `0x${toHex(bytes)}`;
const plain = (hex: string) => hex.replace(/^0x/i, '').toLowerCase();

/** Leaf of `(account_id, amount)` as the arena computes it: keccak256(keccak256(borsh((String, u128)))). */
export function leafOf(accountId: string, amount: bigint): string {
  return toHex(merkleLeaf(accountId, amount));
}

/**
 * Merkle tree over `merkleLeaf(account_id, amount)` hashes with OpenZeppelin's `SimpleMerkleTree` (sorted leaves,
 * sorted pairs), the layout the arena verifies in `claim_prize` / `claim_bonus`. With no entries the root is zero
 * and nobody can claim.
 */
export function buildTree(entries: readonly Entry[]): BuiltTree {
  if (entries.length === 0) return { root: EMPTY_ROOT, proofs: new Map() };

  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.address)) throw new Error(`Duplicate account in a merkle tree: ${e.address}`);
    seen.add(e.address);
  }
  const leaves = entries.map((e) => ozHex(merkleLeaf(e.address, e.amount)));
  const tree = SimpleMerkleTree.of(leaves);
  const proofs = new Map<string, string[]>();
  entries.forEach((e, i) => proofs.set(e.address, tree.getProof(leaves[i]!).map(plain)));
  return { root: plain(tree.root), proofs };
}

export function verifyProof(
  root: string,
  address: string,
  amount: bigint,
  proof: readonly string[],
): boolean {
  if (plain(root) === EMPTY_ROOT) return false;
  return SimpleMerkleTree.verify(
    `0x${plain(root)}`,
    ozHex(merkleLeaf(address, amount)),
    proof.map((p) => `0x${plain(p)}`),
  );
}

/** Proof nodes as the arena's claim methods take them: base64 of 32 bytes each. */
export function proofToBase64(proof: readonly string[]): string[] {
  return proof.map((p) => Buffer.from(fromHex(plain(p))).toString('base64'));
}

export function rootToBase64(root: string): string {
  return Buffer.from(fromHex(plain(root))).toString('base64');
}

/**
 * The 3-leaf tree of `contracts/arena/tests/vectors/merkle.json`, which the arena's own tests produce. The keeper
 * rebuilds it before posting any root, so a library or encoding change can never post a root the arena rejects.
 */
export const SELF_CHECK_VECTOR = {
  root: '14ed5b14dd0459aa6ab8e6928e90079a770e9a3d05eec7f6f66d6a0f747637a1',
  entries: [
    { address: 'hairto-player01.testnet', amount: 1_234_568n },
    { address: 'hairto-player02.testnet', amount: 2_469_135n },
    { address: 'hairto-player03.testnet', amount: 3_703_702n },
  ],
  proofOfSecond: [
    'bc36f85c45d295bd4652c2e0a3d4b0e07060c3ac1aebee784dfa3cb1b2e3c5f9',
    'f1905006ddeb0be1e22daa289c4110d8d4e9cea50f5e20003eb39fb0255897cf',
  ],
} as const;

/** Throws when this build does not reproduce the arena's merkle vector bit for bit. */
export function assertMerkleSelfCheck(): void {
  const { root, proofs } = buildTree(SELF_CHECK_VECTOR.entries);
  const proof = proofs.get(SELF_CHECK_VECTOR.entries[1].address) ?? [];
  if (root !== SELF_CHECK_VECTOR.root || proof.join() !== SELF_CHECK_VECTOR.proofOfSecond.join()) {
    throw new Error('Merkle self-check failed: this build does not reproduce the arena vector');
  }
}
