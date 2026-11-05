//! Seed tickets, commits and seed hashes.

use ed25519_dalek::SigningKey;
use near_sdk::borsh;

use super::*;
use crate::params::TICKET_DOMAIN;

#[test]
fn ticket_message_is_borsh_of_domain_arena_and_ticket() {
    let w = World::new();
    let ticket = w.ticket(&fighter(), BTC, 2);
    let seed_hash: [u8; 32] = ticket.seed_hash.0.clone().try_into().unwrap();
    let expected = borsh::to_vec(&(
        TICKET_DOMAIN.to_string(),
        arena_id(),
        (
            fighter(),
            BTC,
            2u8,
            seed_hash,
            ticket.nonce,
            ticket.deadline_ms,
        ),
    ))
    .unwrap();
    ctx(&stranger(), w.now);
    assert_eq!(w.arena.ticket_message(ticket.clone()).0, expected);
    assert_eq!(ticket_message_bytes(&ticket, arena_id()), expected);
}

#[test]
fn signed_ticket_starts_a_pending_duel() {
    let mut w = World::new();
    let ticket = w.ticket(&fighter(), BTC, 1);
    let sig = w.sign(&ticket);
    let _ = w.call(&fighter()).start_duel(ticket, sig);
    assert_eq!(w.arena.nonce_of(fighter()), 1);
    assert_eq!(
        w.arena.active_duel_of(fighter()),
        Some(crate::types::ActiveSlot::Pending {
            nonce: 0,
            since_ms: T0
        })
    );
    // One promise to the vault, one callback receipt.
    let receipts = near_sdk::test_utils::get_created_receipts();
    assert_eq!(receipts.len(), 2);
    assert_eq!(receipts[0].receiver_id, vault());
    assert_eq!(receipts[1].receiver_id, arena_id());
}

#[test]
fn wrong_key_is_rejected_and_nonce_unchanged() {
    let mut w = World::new();
    let ticket = w.ticket(&fighter(), BTC, 1);
    let other = SigningKey::from_bytes(&[3u8; 32]);
    let sig = World::sign_with(&other, &ticket, arena_id());
    assert!(fails(|| w.call(&fighter()).start_duel(ticket, sig)));
    assert_eq!(w.arena.nonce_of(fighter()), 0);
    assert!(w.arena.active_duel_of(fighter()).is_none());
}

#[test]
fn wrong_arena_account_is_rejected() {
    let mut w = World::new();
    let ticket = w.ticket(&fighter(), BTC, 1);
    let sig = World::sign_with(&w.key, &ticket, acc("other-arena.test.near"));
    assert!(fails(|| w.call(&fighter()).start_duel(ticket, sig)));
}

#[test]
fn tampered_ticket_is_rejected() {
    let mut w = World::new();
    let ticket = w.ticket(&fighter(), BTC, 1);
    let sig = w.sign(&ticket);
    let mut tampered = ticket.clone();
    tampered.bot_level = 2;
    assert!(fails(|| w
        .call(&fighter())
        .start_duel(tampered, sig.clone())));
    let mut short = sig.clone();
    short.0.pop();
    assert!(fails(|| w.call(&fighter()).start_duel(ticket, short)));
}

#[test]
fn replayed_ticket_fails() {
    let mut w = World::new();
    let ticket = w.ticket(&fighter(), BTC, 1);
    let sig = w.sign(&ticket);
    let _ = w.call(&fighter()).start_duel(ticket.clone(), sig.clone());
    // Even after the duel is rejected the ticket is spent.
    w.call(&arena_id()).on_start_duel(ticket.clone(), Ok(false));
    assert!(w.arena.active_duel_of(fighter()).is_none());
    assert!(fails(|| w.call(&fighter()).start_duel(ticket, sig)));
}

#[test]
fn compute_commit_matches_close() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start);
    let commit = w
        .call(&stranger())
        .compute_commit(Dir::Short, b64(&[5u8; 32]), id, fighter());
    assert_eq!(
        commit.0,
        commit_hash(Dir::Short, &[5u8; 32], id, &fighter()).to_vec()
    );
    w.call(&fighter()).open_position(id, commit);
    w.advance(start + 3_000);
    w.close(id, &fighter(), Dir::Short, 5);
    assert_eq!(event_names(), vec!["position_closed"]);
}

#[test]
fn commit_and_seed_hash_layout() {
    ctx(&stranger(), T0);
    let salt = [1u8; 32];
    let bytes = borsh::to_vec(&(1u8, salt, 7u64, fighter())).unwrap();
    assert_eq!(
        commit_hash(Dir::Long, &salt, 7, &fighter()),
        near_sdk::env::sha256_array(bytes)
    );
    assert_ne!(
        commit_hash(Dir::Long, &salt, 7, &fighter()),
        commit_hash(Dir::Short, &salt, 7, &fighter())
    );
    let seed_bytes = borsh::to_vec(&(SEED, fighter(), 3u64)).unwrap();
    assert_eq!(
        seed_hash(&SEED, &fighter(), 3),
        near_sdk::env::sha256_array(seed_bytes)
    );
    let w = World::new();
    ctx(&stranger(), T0);
    assert_eq!(
        w.arena.compute_seed_hash(b64(&SEED), fighter(), 3).0,
        seed_hash(&SEED, &fighter(), 3).to_vec()
    );
    assert!(fails(|| w.arena.compute_seed_hash(
        b64(&[1; 31]),
        fighter(),
        3
    )));
}
