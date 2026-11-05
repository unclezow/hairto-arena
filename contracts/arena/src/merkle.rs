//! Merkle proofs for season payouts, in the tree shape of OpenZeppelin `StandardMerkleTree`: a double-hashed keccak
//! leaf and keccak over sorted pairs. The leaf payload is `borsh((account_id: String, amount: u128))`, because NEAR
//! accounts are strings.

use near_sdk::env;

use crate::types::Hash32;

/// `keccak256(keccak256(borsh((account_id, amount))))`.
pub fn leaf_hash(account_id: &str, amount: u128) -> Hash32 {
    let bytes =
        near_sdk::borsh::to_vec(&(account_id.to_string(), amount)).unwrap_or_else(|_| env::abort());
    env::keccak256_array(env::keccak256_array(bytes))
}

/// `keccak256(min(a, b) ‖ max(a, b))`.
pub fn hash_pair(a: &Hash32, b: &Hash32) -> Hash32 {
    let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
    let mut buf = [0u8; 64];
    buf[..32].copy_from_slice(lo);
    buf[32..].copy_from_slice(hi);
    env::keccak256_array(buf)
}

/// Folds `proof` from `leaf` and compares with `root`. An all-zero root never verifies.
pub fn verify(proof: &[Hash32], root: &Hash32, leaf: Hash32) -> bool {
    if *root == [0u8; 32] {
        return false;
    }
    let computed = proof
        .iter()
        .fold(leaf, |acc, sibling| hash_pair(&acc, sibling));
    computed == *root
}

/// Tree building as in OpenZeppelin `makeMerkleTree` / `getProof`, used by tests and the committed vectors. Leaves
/// are sorted, placed at the end of a complete binary tree stored in an array, and hashed upwards; the root is
/// `tree[0]`.
#[cfg(test)]
pub mod tree {
    use super::{hash_pair, Hash32};

    pub struct Tree {
        pub nodes: Vec<Hash32>,
        /// Leaves in sorted order.
        pub leaves: Vec<Hash32>,
    }

    pub fn build(mut leaves: Vec<Hash32>) -> Tree {
        assert!(!leaves.is_empty());
        leaves.sort();
        let n = leaves.len();
        let mut nodes = vec![[0u8; 32]; 2 * n - 1];
        for (i, leaf) in leaves.iter().enumerate() {
            let len = nodes.len();
            nodes[len - 1 - i] = *leaf;
        }
        for i in (0..nodes.len() - n).rev() {
            nodes[i] = hash_pair(&nodes[2 * i + 1], &nodes[2 * i + 2]);
        }
        Tree { nodes, leaves }
    }

    impl Tree {
        pub fn root(&self) -> Hash32 {
            self.nodes[0]
        }

        pub fn proof(&self, leaf: &Hash32) -> Vec<Hash32> {
            let pos = self
                .leaves
                .iter()
                .position(|l| l == leaf)
                .expect("leaf in tree");
            let mut index = self.nodes.len() - 1 - pos;
            let mut proof = Vec::new();
            while index > 0 {
                let sibling = if index % 2 == 1 { index + 1 } else { index - 1 };
                proof.push(self.nodes[sibling]);
                index = (index - 1) / 2;
            }
            proof
        }
    }
}
