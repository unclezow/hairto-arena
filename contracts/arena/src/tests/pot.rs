//! `season-pot` scenarios.

use near_sdk::json_types::U128;
use near_sdk::PromiseOrValue;

use super::*;

const USDC: u128 = 1_000_000;

fn usdc() -> AccountId {
    acc("usdc.test.near")
}

fn with_token(w: &mut World) {
    w.call(&owner()).set_token_id(usdc());
}

/// `ft_on_transfer` called by `token`; returns the unused amount.
fn transfer_in(
    w: &mut World,
    token: &AccountId,
    sender: &AccountId,
    amount: u128,
    msg: &str,
) -> u128 {
    match w
        .call(token)
        .ft_on_transfer(sender.clone(), U128(amount), msg.to_string())
    {
        PromiseOrValue::Value(unused) => unused.0,
        PromiseOrValue::Promise(_) => panic!("no promise expected"),
    }
}

#[test]
fn set_token_once() {
    let mut w = World::new();
    assert!(fails(|| w.call(&stranger()).set_token_id(usdc())));
    with_token(&mut w);
    assert_eq!(w.arena.get_config().token_id, Some(usdc()));
    assert!(
        fails(|| w.call(&owner()).set_token_id(acc("other.test.near"))),
        "set twice"
    );
}

#[test]
fn vault_funds_the_current_season() {
    let mut w = World::new();
    with_token(&mut w);
    assert_eq!(
        transfer_in(&mut w, &usdc(), &vault(), 95 * USDC, "fund_pot"),
        0
    );
    let e = find_event("pot_funded").unwrap();
    assert_eq!(e["data"]["season"], 1);
    assert_eq!(e["data"]["pot"], (95 * USDC).to_string());
    assert_eq!(w.arena.pot_of(1), U128(95 * USDC));
    assert_eq!(w.arena.total_pots(), U128(95 * USDC));
    assert_eq!(w.arena.get_season(1).unwrap().pot, U128(95 * USDC));
}

#[test]
fn everything_else_is_refunded() {
    let mut w = World::new();
    // Token not set yet.
    assert_eq!(transfer_in(&mut w, &usdc(), &vault(), 5, "fund_pot"), 5);
    assert_eq!(
        find_event("pot_funding_rejected").unwrap()["data"]["reason"],
        "token_not_set"
    );
    with_token(&mut w);
    let cases: [(AccountId, AccountId, u128, &str, &str); 4] = [
        (usdc(), stranger(), 7, "fund_pot", "not_vault"),
        (
            acc("fake-usdc.test.near"),
            vault(),
            7,
            "fund_pot",
            "wrong_token",
        ),
        (usdc(), vault(), 7, "pot", "bad_msg"),
        (usdc(), vault(), 0, "fund_pot", "zero_amount"),
    ];
    for (token, sender, amount, msg, reason) in cases {
        assert_eq!(transfer_in(&mut w, &token, &sender, amount, msg), amount);
        assert_eq!(
            find_event("pot_funding_rejected").unwrap()["data"]["reason"],
            reason
        );
    }
    assert_eq!(w.arena.total_pots(), U128(0));
    assert_eq!(w.arena.pot_of(1), U128(0));
}

#[test]
fn funding_season_before_the_first_season() {
    ctx(&owner(), T0);
    let key = ed25519_dalek::SigningKey::from_bytes(&[1; 32]);
    let arena = Arena::new(owner(), vault(), public_key(&key), None);
    assert_eq!(arena.funding_season(), 1);
}

#[test]
fn funding_goes_to_the_next_season_after_close() {
    let mut w = World::new();
    with_token(&mut w);
    assert_eq!(w.arena.funding_season(), 1, "Picking");
    w.feed_on = false;
    w.advance(T0 + 2 * 24 * 3_600_000);
    assert_eq!(w.call(&stranger()).funding_season(), 1, "Active");
    w.call(&operator()).end_season_now();
    w.call(&stranger()).close_season();
    assert_eq!(w.arena.funding_season(), 2);
    assert_eq!(
        transfer_in(&mut w, &usdc(), &vault(), 3 * USDC, "fund_pot"),
        0
    );
    assert_eq!(w.arena.pot_of(1), U128(0), "a closed pot never changes");
    assert_eq!(w.arena.pot_of(2), U128(3 * USDC));
    w.call(&operator()).start_season(vec![2]);
    assert_eq!(w.arena.funding_season(), 2);
    assert_eq!(w.arena.get_season(2).unwrap().pot, U128(3 * USDC));
}

#[test]
fn pots_add_up_to_the_total() {
    let mut w = World::new();
    with_token(&mut w);
    let mut expected = 0u128;
    for (i, amount) in [1u128, 17, 250, 3].into_iter().enumerate() {
        if i == 2 {
            w.call(&operator()).end_season_now();
            w.call(&stranger()).close_season();
        }
        transfer_in(&mut w, &usdc(), &vault(), amount * USDC, "fund_pot");
        expected += amount * USDC;
        let sum = w.arena.pot_of(1).0 + w.arena.pot_of(2).0;
        assert_eq!((sum, w.arena.total_pots().0), (expected, expected));
    }
}
