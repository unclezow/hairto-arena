//! `backer-picks` scenarios with simulated vault answers.

use near_sdk::PromiseError;

use super::*;
use crate::types::{PendingPick, VaultPool};

fn backer() -> AccountId {
    acc("backer.test.near")
}

/// `pick` by `backer`, then the callback with the two vault answers.
fn pick_with(
    w: &mut World,
    backer: &AccountId,
    fighter: &AccountId,
    can_pick: Result<bool, PromiseError>,
    role: Result<Option<VaultPool>, PromiseError>,
) -> bool {
    let _ = w.call(backer).pick(fighter.clone());
    let season = w.arena.current_season();
    w.call(&arena_id())
        .on_pick(backer.clone(), season, fighter.clone(), can_pick, role)
}

fn eligible(w: &mut World, backer: &AccountId, fighter: &AccountId) -> bool {
    pick_with(w, backer, fighter, Ok(true), Ok(Some(VaultPool::Fighter)))
}

#[test]
fn valid_pick() {
    let mut w = World::new();
    let _ = w.call(&backer()).pick(fighter());
    assert_eq!(
        w.arena.pending_pick_of(backer()),
        Some(PendingPick {
            season: 1,
            fighter: fighter(),
            since_ms: T0
        })
    );
    // Two joined vault views and the callback.
    let receivers: Vec<_> = near_sdk::test_utils::get_created_receipts()
        .into_iter()
        .map(|r| r.receiver_id)
        .collect();
    assert_eq!(receivers, vec![vault(), vault(), arena_id()]);

    assert!(w.call(&arena_id()).on_pick(
        backer(),
        1,
        fighter(),
        Ok(true),
        Ok(Some(VaultPool::Fighter))
    ));
    let e = find_event("picked").unwrap();
    assert_eq!(e["data"]["backer_count"], 1);
    assert_eq!(w.arena.pick_of(1, backer()), Some(fighter()));
    assert_eq!(w.arena.backer_count(1, fighter()), 1);
    assert!(w.arena.pending_pick_of(backer()).is_none());

    let other = acc("backer2.test.near");
    assert!(eligible(&mut w, &other, &fighter()));
    assert_eq!(w.arena.backer_count(1, fighter()), 2);
}

#[test]
fn window_closed() {
    let mut w = World::new();
    w.feed_on = false;
    w.advance(T0 + 24 * 3_600_000);
    assert!(fails(|| w.call(&backer()).pick(fighter())));
    assert!(w.arena.pending_pick_of(backer()).is_none());
}

#[test]
fn no_season_means_no_window() {
    ctx(&owner(), T0);
    let key = ed25519_dalek::SigningKey::from_bytes(&[1; 32]);
    let mut arena = Arena::new(owner(), vault(), public_key(&key), None);
    ctx(&backer(), T0);
    assert!(fails(|| arena.pick(fighter())));
}

#[test]
fn second_pick_and_self_pick_fail() {
    let mut w = World::new();
    assert!(fails(|| w.call(&backer()).pick(backer())), "self pick");
    assert!(eligible(&mut w, &backer(), &fighter()));
    assert!(fails(|| w
        .call(&backer())
        .pick(acc("other-fighter.test.near"))));
    // A pending pick also blocks a second request.
    let other = acc("backer2.test.near");
    let _ = w.call(&other).pick(fighter());
    assert!(fails(|| w
        .call(&other)
        .pick(acc("other-fighter.test.near"))));
}

#[test]
fn not_enough_gas() {
    let mut w = World::new();
    ctx_with_gas(&backer(), w.now, Gas::from_tgas(49));
    assert!(fails(|| w.arena.pick(fighter())));
}

#[test]
fn under_minimum() {
    let mut w = World::new();
    assert!(!pick_with(
        &mut w,
        &backer(),
        &fighter(),
        Ok(false),
        Ok(Some(VaultPool::Fighter))
    ));
    assert_eq!(
        find_event("pick_rejected").unwrap()["data"]["reason"],
        "not_eligible_backer"
    );
    assert!(w.arena.pick_of(1, backer()).is_none());
    assert_eq!(w.arena.backer_count(1, fighter()), 0);
    assert!(w.arena.pending_pick_of(backer()).is_none());
}

#[test]
fn picked_account_is_not_a_fighter() {
    let mut w = World::new();
    for role in [None, Some(VaultPool::Backer)] {
        assert!(!pick_with(
            &mut w,
            &backer(),
            &fighter(),
            Ok(true),
            Ok(role)
        ));
        assert_eq!(
            find_event("pick_rejected").unwrap()["data"]["reason"],
            "not_a_fighter"
        );
    }
    assert!(w.arena.pick_of(1, backer()).is_none());
}

#[test]
fn vault_call_fails() {
    let mut w = World::new();
    assert!(!pick_with(
        &mut w,
        &backer(),
        &fighter(),
        Err(PromiseError::Failed),
        Ok(Some(VaultPool::Fighter))
    ));
    assert_eq!(
        find_event("pick_rejected").unwrap()["data"]["reason"],
        "vault_error"
    );
    assert!(!pick_with(
        &mut w,
        &backer(),
        &fighter(),
        Ok(true),
        Err(PromiseError::Failed)
    ));
    assert_eq!(
        find_event("pick_rejected").unwrap()["data"]["reason"],
        "vault_error"
    );
    assert!(w.arena.pending_pick_of(backer()).is_none());
    // The Backer can try again.
    assert!(eligible(&mut w, &backer(), &fighter()));
}

#[test]
fn picks_stay_locked() {
    let mut w = World::new();
    assert!(eligible(&mut w, &backer(), &fighter()));
    // Later rejections (for example after the Backer withdrew) cannot touch a stored pick.
    w.advance(T0 + 3_600_000);
    assert!(fails(|| w
        .call(&backer())
        .pick(acc("other-fighter.test.near"))));
    assert_eq!(w.arena.pick_of(1, backer()), Some(fighter()));
    // A stray callback for the same Backer changes nothing.
    assert!(!w.call(&arena_id()).on_pick(
        backer(),
        1,
        acc("other-fighter.test.near"),
        Ok(true),
        Ok(Some(VaultPool::Fighter))
    ));
    assert_eq!(w.arena.pick_of(1, backer()), Some(fighter()));
    assert_eq!(w.arena.backer_count(1, acc("other-fighter.test.near")), 0);
}

#[test]
fn clear_stale_pick() {
    let mut w = World::new();
    assert!(
        fails(|| w.call(&stranger()).clear_stale_pick(backer())),
        "nothing pending"
    );
    let _ = w.call(&backer()).pick(fighter());
    w.advance(T0 + 30_000);
    assert!(
        fails(|| w.call(&stranger()).clear_stale_pick(backer())),
        "too young"
    );
    w.advance(T0 + 61_000);
    w.call(&stranger()).clear_stale_pick(backer());
    assert_eq!(
        find_event("pick_rejected").unwrap()["data"]["reason"],
        "pending_timeout"
    );
    assert!(w.arena.pending_pick_of(backer()).is_none());
    // A late callback for the cleared request changes nothing; the Backer can pick again.
    assert!(!w.call(&arena_id()).on_pick(
        backer(),
        1,
        fighter(),
        Ok(true),
        Ok(Some(VaultPool::Fighter))
    ));
    assert!(w.arena.pick_of(1, backer()).is_none());
    assert!(eligible(&mut w, &backer(), &fighter()));
}

#[test]
fn unknown_entries() {
    let w = World::new();
    ctx(&stranger(), T0);
    assert_eq!(w.arena.pick_of(1, backer()), None);
    assert_eq!(w.arena.pick_of(9, backer()), None);
    assert_eq!(w.arena.backer_count(1, fighter()), 0);
}
