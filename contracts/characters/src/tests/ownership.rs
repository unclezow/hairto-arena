//! `character-ownership` scenarios: purchases through `ft_on_transfer`, grants, and equip.

use near_sdk::PromiseOrValue;

use super::*;
use crate::Role;

fn buy_msg(id: &str) -> String {
    format!(r#"{{"buy":"{id}"}}"#)
}

/// `ft_on_transfer` from `token`; returns the unused amount.
fn pay(c: &mut Characters, token: &AccountId, buyer: &AccountId, amount: u128, msg: &str) -> u128 {
    ctx(token);
    match c.ft_on_transfer(buyer.clone(), U128(amount), msg.to_string()) {
        PromiseOrValue::Value(unused) => unused.0,
        PromiseOrValue::Promise(_) => panic!("no promise expected"),
    }
}

fn rejected(c: &mut Characters, buyer: &AccountId, amount: u128, msg: &str) -> String {
    assert_eq!(pay(c, &usdc(), buyer, amount, msg), amount, "full refund");
    event("hairto", "purchase_rejected").unwrap()["data"]["reason"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn purchase_refunds_the_excess() {
    let mut c = with_catalog();
    assert_eq!(
        pay(&mut c, &usdc(), &alice(), usd(2), &buy_msg("1")),
        usd(1)
    );
    let mint = event("nep245", "mt_mint").unwrap();
    assert_eq!(mint["version"], "1.0.0");
    assert_eq!(mint["data"][0]["owner_id"], alice().as_str());
    assert_eq!(mint["data"][0]["token_ids"][0], "1");
    assert_eq!(mint["data"][0]["amounts"][0], "1");
    let bought = event("hairto", "character_purchased").unwrap();
    assert_eq!(bought["data"]["price"], usd(1).to_string());
    assert_eq!(c.balance(1, &alice()), 1);
    assert_eq!(c.get_config().treasury_balance, U128(usd(1)));
    assert_eq!(c.get_character("1".into()).unwrap().minted, 1);
    // Exact payment returns nothing.
    assert_eq!(pay(&mut c, &usdc(), &bob(), usd(1), &buy_msg("1")), 0);
    assert_eq!(c.get_config().treasury_balance, U128(usd(2)));
}

#[test]
fn rejections() {
    let mut c = with_catalog();
    assert_eq!(
        rejected(&mut c, &alice(), 500_000, &buy_msg("1")),
        "underpaid"
    );
    pay(&mut c, &usdc(), &alice(), usd(1), &buy_msg("1"));
    assert_eq!(
        rejected(&mut c, &alice(), usd(1), &buy_msg("1")),
        "already_owned"
    );
    for msg in ["", "buy 1", r#"{"buy":1}"#, r#"{"sell":"1"}"#] {
        assert_eq!(rejected(&mut c, &bob(), usd(1), msg), "bad_msg", "{msg}");
    }
    for id in ["0", "9", "abc", "01"] {
        assert_eq!(
            rejected(&mut c, &bob(), usd(9), &buy_msg(id)),
            "not_for_sale",
            "{id}"
        );
    }
    ctx(&owner());
    c.update_character("2".into(), None, None, None, Some(false));
    assert_eq!(
        rejected(&mut c, &bob(), usd(9), &buy_msg("2")),
        "not_for_sale",
        "inactive"
    );
    ctx(&guardian());
    c.pause();
    assert_eq!(rejected(&mut c, &bob(), usd(9), &buy_msg("3")), "paused");
    assert_eq!(c.get_config().treasury_balance, U128(usd(1)));
    assert_eq!(c.balance(3, &bob()), 0);
}

#[test]
fn sold_out() {
    let mut c = with_catalog();
    ctx(&owner());
    c.update_character("4".into(), None, None, Some(1), None);
    pay(&mut c, &usdc(), &alice(), usd(5), &buy_msg("4"));
    assert_eq!(rejected(&mut c, &bob(), usd(5), &buy_msg("4")), "sold_out");
}

#[test]
fn another_token_fails() {
    let mut c = with_catalog();
    assert!(fails(|| pay(
        &mut c,
        &acc("fake-usdc.test.near"),
        &alice(),
        usd(1),
        &buy_msg("1")
    )));
}

#[test]
fn reward_grant() {
    let mut c = with_catalog();
    ctx(&minter());
    c.grant(alice(), "4".into());
    assert!(event("nep245", "mt_mint").is_some());
    assert_eq!(
        event("hairto", "character_granted").unwrap()["data"]["token_id"],
        "4"
    );
    assert_eq!(c.balance(4, &alice()), 1);
    assert_eq!(c.get_config().treasury_balance, U128(0), "no payment");
    assert!(fails(|| c.grant(alice(), "4".into())), "one copy");
    assert!(
        fails(|| c.grant(bob(), "0".into())),
        "default is never minted"
    );
    assert!(fails(|| c.grant(bob(), "9".into())));
    ctx(&owner());
    assert!(
        fails(|| c.grant(bob(), "1".into())),
        "owner is not a minter"
    );
    c.update_character("3".into(), None, None, Some(1), None);
    ctx(&minter());
    c.grant(bob(), "3".into());
    assert!(fails(|| c.grant(alice(), "3".into())), "sold out");
    ctx(&guardian());
    c.pause();
    ctx(&minter());
    assert!(fails(|| c.grant(bob(), "1".into())), "paused");
    ctx(&owner());
    c.revoke_role(Role::Minter, minter());
    ctx(&minter());
    assert!(fails(|| c.grant(bob(), "2".into())));
}

#[test]
fn equip() {
    let mut c = with_catalog();
    pay(&mut c, &usdc(), &alice(), usd(2), &buy_msg("2"));
    ctx(&alice());
    assert_eq!(c.equipped_of(alice()), "0");
    c.equip("2".into());
    assert_eq!(
        event("hairto", "character_equipped").unwrap()["data"]["token_id"],
        "2"
    );
    assert_eq!(c.equipped_of(alice()), "2");
    assert!(fails(|| c.equip("1".into())), "not held");
    assert!(fails(|| c.equip("x".into())));
    c.equip("0".into());
    assert_eq!(c.equipped_of(alice()), "0");
    assert!(
        !c.equipped.contains_key(&alice()),
        "no entry stored for the default"
    );
    // Equip keeps working while the shop is paused.
    ctx(&guardian());
    c.pause();
    ctx(&alice());
    c.equip("2".into());
    assert_eq!(c.equipped_of(alice()), "2");
}
