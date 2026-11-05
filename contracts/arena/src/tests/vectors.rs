//! Hash vectors for the TypeScript port (`packages/shared/src/hashing.ts`): commits, seed hashes and ticket
//! messages, written to `tests/vectors/hashes.json`.
//!
//! Regenerate after an intended format change with `HAIRTO_WRITE_VECTORS=1 cargo test -p arena vectors`.

use near_sdk::json_types::Base64VecU8;
use near_sdk::serde_json::{json, Value};

use super::*;
use crate::duel::{commit_hash, seed_hash, ticket_message_bytes};
use crate::types::SeedTicket;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

const IMPLICIT: &str = "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de";

#[test]
fn committed_hash_vectors_match() {
    ctx(&stranger(), T0);
    let commits: Vec<Value> = [
        (Dir::Long, [1u8; 32], 1u64, "fighter.testnet"),
        (Dir::Short, [0xab; 32], 42, "rookie.bots.hairto.testnet"),
        (Dir::Long, [7; 32], u64::MAX, IMPLICIT),
    ]
    .iter()
    .map(|(dir, salt, duel_id, player)| {
        let commit = commit_hash(*dir, salt, *duel_id, &acc(player));
        json!({
            "dir": dir.as_u8(),
            "salt": hex(salt),
            "duel_id": duel_id.to_string(),
            "player": player,
            "commit": hex(&commit),
        })
    })
    .collect();

    let seeds: Vec<Value> = [
        ([9u8; 32], "fighter.testnet", 0u64),
        ([0x5a; 32], IMPLICIT, 7),
        ([0xff; 32], "a.testnet", u64::MAX),
    ]
    .iter()
    .map(|(seed, fighter, nonce)| {
        json!({
            "seed": hex(seed),
            "fighter": fighter,
            "nonce": nonce.to_string(),
            "seed_hash": hex(&seed_hash(seed, &acc(fighter), *nonce)),
        })
    })
    .collect();

    let tickets: Vec<Value> = [
        (
            "arena.hairto.testnet",
            "fighter.testnet",
            2u32,
            1u8,
            [3u8; 32],
            0u64,
            1_800_000_030_000u64,
        ),
        (
            "arena2.hairto.testnet",
            IMPLICIT,
            1,
            4,
            [0xee; 32],
            123,
            u64::MAX,
        ),
    ]
    .iter()
    .map(
        |(arena, fighter, asset_id, bot_level, hash, nonce, deadline_ms)| {
            let ticket = SeedTicket {
                fighter: acc(fighter),
                asset_id: *asset_id,
                bot_level: *bot_level,
                seed_hash: Base64VecU8(hash.to_vec()),
                nonce: *nonce,
                deadline_ms: *deadline_ms,
            };
            json!({
                "arena": arena,
                "fighter": fighter,
                "asset_id": asset_id,
                "bot_level": bot_level,
                "seed_hash": hex(hash),
                "nonce": nonce.to_string(),
                "deadline_ms": deadline_ms.to_string(),
                "message": hex(&ticket_message_bytes(&ticket, acc(arena))),
            })
        },
    )
    .collect();

    let doc = json!({
        "commit": "sha256(borsh((dir: u8, salt: [u8; 32], duel_id: u64, player: String))), Long = 1, Short = 2",
        "seed_hash": "sha256(borsh((seed: [u8; 32], fighter: String, nonce: u64)))",
        "ticket_message": "borsh(TicketMessage { domain: \"hairto-arena/seed-ticket/v1\", arena: String, ticket: { fighter: String, asset_id: u32, bot_level: u8, seed_hash: [u8; 32], nonce: u64, deadline_ms: u64 } })",
        "encoding": "hex without prefix; u64 values as decimal strings",
        "commits": commits,
        "seed_hashes": seeds,
        "ticket_messages": tickets,
    });
    let text = near_sdk::serde_json::to_string_pretty(&doc).unwrap() + "\n";
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/vectors/hashes.json");
    if std::env::var_os("HAIRTO_WRITE_VECTORS").is_some() || !path.exists() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &text).unwrap();
    }
    let committed = std::fs::read_to_string(&path).unwrap();
    assert_eq!(committed, text, "tests/vectors/hashes.json is out of date");
}
