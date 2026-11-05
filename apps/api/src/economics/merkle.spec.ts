import vectors from '../../../../contracts/arena/tests/vectors/merkle.json' with { type: 'json' };
import {
  assertMerkleSelfCheck,
  buildTree,
  EMPTY_ROOT,
  leafOf,
  proofToBase64,
  SELF_CHECK_VECTOR,
  verifyProof,
} from './merkle.js';

describe('merkle trees for the arena', () => {
  it.each(vectors.trees)('reproduces the $name vector bit for bit', (tree) => {
    const entries = tree.entries.map((e) => ({ address: e.account_id, amount: BigInt(e.amount) }));
    const built = buildTree(entries);
    expect(built.root).toBe(tree.root);
    for (const e of tree.entries) {
      expect(leafOf(e.account_id, BigInt(e.amount))).toBe(e.leaf);
      expect(built.proofs.get(e.account_id)).toEqual(e.proof);
      expect(verifyProof(built.root, e.account_id, BigInt(e.amount), e.proof)).toBe(true);
    }
  });

  it('keeps the embedded self-check vector equal to the committed file', () => {
    const tree = vectors.trees.find((t) => t.name === '3-leaf')!;
    expect(SELF_CHECK_VECTOR.root).toBe(tree.root);
    expect(SELF_CHECK_VECTOR.entries.map((e) => [e.address, e.amount.toString()])).toEqual(
      tree.entries.map((e) => [e.account_id, e.amount]),
    );
    expect(SELF_CHECK_VECTOR.proofOfSecond).toEqual(tree.entries[1]!.proof);
    expect(() => assertMerkleSelfCheck()).not.toThrow();
  });

  it('rejects a wrong amount, account or proof', () => {
    const entries = vectors.trees[2]!.entries.map((e) => ({
      address: e.account_id,
      amount: BigInt(e.amount),
    }));
    const { root, proofs } = buildTree(entries);
    const [a, b] = entries;
    expect(verifyProof(root, a!.address, a!.amount + 1n, proofs.get(a!.address)!)).toBe(false);
    expect(verifyProof(root, 'other.testnet', a!.amount, proofs.get(a!.address)!)).toBe(false);
    expect(verifyProof(root, a!.address, a!.amount, proofs.get(b!.address)!)).toBe(false);
    expect(buildTree([...entries].reverse()).root).toBe(root);
  });

  it('has a zero root for no entries, which never verifies, and refuses duplicates', () => {
    expect(buildTree([]).root).toBe(EMPTY_ROOT);
    expect(verifyProof(EMPTY_ROOT, 'a.testnet', 1n, [])).toBe(false);
    expect(() =>
      buildTree([
        { address: 'a.testnet', amount: 1n },
        { address: 'a.testnet', amount: 2n },
      ]),
    ).toThrow('Duplicate');
  });

  it('encodes proof nodes as base64 for the claim methods', () => {
    expect(proofToBase64(['00'.repeat(31) + 'ff'])).toEqual([
      Buffer.from('00'.repeat(31) + 'ff', 'hex').toString('base64'),
    ]);
  });
});
