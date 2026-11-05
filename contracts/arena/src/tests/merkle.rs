//! Merkle leaf and proof format, and the committed vectors in `tests/vectors/merkle.json` for the keeper.
//!
//! Regenerate the file after an intended format change with `HAIRTO_WRITE_VECTORS=1 cargo test -p arena merkle`.

use near_sdk::serde_json::{json, Value};

use super::*;
use crate::merkle::{hash_pair, leaf_hash, tree, verify};
use crate::types::Hash32;

fn hex(bytes: &Hash32) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn entries(n: usize) -> Vec<(String, u128)> {
    (1..=n)
        .map(|i| {
            (
                format!("hairto-player{i:02}.testnet"),
                i as u128 * 1_234_567 + 1,
            )
        })
        .collect()
}

fn tree_json(name: &str, entries: &[(String, u128)]) -> Value {
    let leaves: Vec<Hash32> = entries.iter().map(|(a, v)| leaf_hash(a, *v)).collect();
    let t = tree::build(leaves.clone());
    let root = t.root();
    let mut items = Vec::new();
    for ((account, amount), leaf) in entries.iter().zip(&leaves) {
        let proof = t.proof(leaf);
        assert!(verify(&proof, &root, *leaf), "{name}: proof of {account}");
        items.push(json!({
            "account_id": account,
            "amount": amount.to_string(),
            "leaf": hex(leaf),
            "proof": proof.iter().map(hex).collect::<Vec<_>>(),
        }));
    }
    json!({ "name": name, "root": hex(&root), "entries": items })
}

#[test]
fn leaf_is_double_keccak_of_borsh() {
    ctx(&stranger(), T0);
    let borsh = near_sdk::borsh::to_vec(&("alice.testnet".to_string(), 5u128)).unwrap();
    // u32 length, UTF-8 bytes, 16-byte little-endian amount.
    assert_eq!(&borsh[..4], &13u32.to_le_bytes());
    assert_eq!(&borsh[4..17], b"alice.testnet");
    assert_eq!(&borsh[17..], &5u128.to_le_bytes());
    let expected = near_sdk::env::keccak256_array(near_sdk::env::keccak256_array(&borsh));
    assert_eq!(leaf_hash("alice.testnet", 5), expected);
    let w = World::new();
    ctx(&stranger(), T0);
    assert_eq!(
        w.arena
            .leaf_of(acc("alice.testnet"), near_sdk::json_types::U128(5))
            .0,
        expected.to_vec()
    );
}

#[test]
fn pairs_are_sorted_and_zero_root_never_verifies() {
    ctx(&stranger(), T0);
    let (a, b) = (leaf_hash("a.testnet", 1), leaf_hash("b.testnet", 2));
    assert_eq!(hash_pair(&a, &b), hash_pair(&b, &a));
    let t = tree::build(vec![a, b]);
    assert!(verify(&t.proof(&a), &t.root(), a));
    assert!(!verify(&t.proof(&a), &t.root(), b));
    assert!(!verify(&[], &[0u8; 32], [0u8; 32]));
}

#[test]
fn single_leaf_tree() {
    ctx(&stranger(), T0);
    let leaf = leaf_hash("solo.testnet", 42);
    let t = tree::build(vec![leaf]);
    assert_eq!(t.root(), leaf);
    assert!(t.proof(&leaf).is_empty());
    assert!(verify(&[], &leaf, leaf));
}

#[test]
fn committed_vectors_match() {
    ctx(&stranger(), T0);
    let doc = json!({
        "leaf": "keccak256(keccak256(borsh((account_id: String, amount: u128))))",
        "node": "keccak256(min(a, b) || max(a, b))",
        "layout": "OpenZeppelin makeMerkleTree: sorted leaves at the end of a complete binary tree, root at index 0",
        "encoding": "hex without prefix; amounts in USDC base units as decimal strings",
        "trees": [
            tree_json("1-leaf", &entries(1)),
            tree_json("2-leaf", &entries(2)),
            tree_json("3-leaf", &entries(3)),
            tree_json("20-leaf", &entries(20)),
        ],
    });
    let text = near_sdk::serde_json::to_string_pretty(&doc).unwrap() + "\n";
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/vectors/merkle.json");
    if std::env::var_os("HAIRTO_WRITE_VECTORS").is_some() || !path.exists() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &text).unwrap();
    }
    let committed = std::fs::read_to_string(&path).unwrap();
    assert_eq!(committed, text, "tests/vectors/merkle.json is out of date");
}
