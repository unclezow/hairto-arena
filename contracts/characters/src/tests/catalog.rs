//! `character-catalog` scenarios.

use super::*;
use crate::catalog::parse_token_id;
use crate::Role;

#[test]
fn init_and_config() {
    let c = setup();
    let cfg = c.get_config();
    assert_eq!(
        (cfg.owner_id, cfg.token_id, cfg.treasury_id),
        (owner(), usdc(), treasury())
    );
    assert_eq!(cfg.base_uri, "https://app.example/characters");
    assert!(!cfg.paused);
    assert_eq!((cfg.treasury_balance, cfg.character_count), (U128(0), 0));
    let roles = c.get_roles();
    assert_eq!(
        (roles.guardians, roles.minters),
        (vec![guardian()], vec![minter()])
    );
}

#[test]
fn owner_gates() {
    let mut c = setup();
    ctx(&alice());
    assert!(
        fails(|| c.set_base_uri("https://evil.example".into())),
        "non-owner sets the base URI"
    );
    assert!(fails(|| c.set_treasury(alice())));
    assert!(fails(|| c.grant_role(Role::Minter, alice())));
    assert!(fails(|| c.transfer_ownership(alice())));
    ctx(&owner());
    assert!(fails(|| c.pause()), "the owner holds no role implicitly");
    c.set_base_uri("https://hairto.example/characters".into());
    c.set_treasury(acc("dao.test.near"));
    c.revoke_role(Role::Minter, minter());
    assert_eq!(
        event("hairto", "role_changed").unwrap()["data"]["granted"],
        false
    );
    assert!(!c.has_role(Role::Minter, minter()));
    c.transfer_ownership(alice());
    let cfg = c.get_config();
    assert_eq!(
        (cfg.owner_id, cfg.treasury_id),
        (alice(), acc("dao.test.near"))
    );
    assert_eq!(cfg.base_uri, "https://hairto.example/characters");
}

#[test]
fn list_a_character() {
    let mut c = setup();
    ctx(&owner());
    assert_eq!(c.list_character("Mage".into(), U128(usd(1)), 100), "1");
    let e = event("hairto", "character_listed").unwrap();
    assert_eq!(e["data"]["token_id"], "1");
    assert_eq!(e["data"]["price"], usd(1).to_string());
    let m = c.get_character("1".into()).unwrap();
    assert_eq!(
        (m.name.as_str(), m.price, m.max_supply, m.minted, m.active),
        ("Mage", U128(usd(1)), 100, 0, true)
    );
    assert_eq!(
        c.list_character("Free".into(), U128(0), 0),
        "2",
        "price 0 is allowed"
    );
    assert_eq!(c.get_characters().len(), 2);
    assert!(
        c.get_character("0".into()).is_none(),
        "id 0 is never listed"
    );
    assert!(c.get_character("3".into()).is_none());
    assert!(c.get_character("abc".into()).is_none());
}

#[test]
fn name_bounds_and_non_owner() {
    let mut c = setup();
    ctx(&owner());
    assert!(fails(|| c.list_character("".into(), U128(1), 0)));
    assert!(fails(|| c.list_character("x".repeat(33), U128(1), 0)));
    c.list_character("é".repeat(32), U128(1), 0);
    ctx(&alice());
    assert!(
        fails(|| c.list_character("Mage".into(), U128(1), 0)),
        "non-owner lists"
    );
}

#[test]
fn update_and_supply_floor() {
    let mut c = setup();
    ctx(&owner());
    c.list_character("Mage".into(), U128(usd(1)), 100);
    c.listing_mut(1).unwrap().minted = 10;
    assert!(
        fails(|| c.update_character("1".into(), None, None, Some(5), None)),
        "below minted"
    );
    c.update_character(
        "1".into(),
        Some("Archmage".into()),
        Some(U128(usd(4))),
        Some(10),
        Some(false),
    );
    let e = event("hairto", "character_updated").unwrap();
    assert_eq!(
        (e["data"]["name"].as_str(), e["data"]["active"].as_bool()),
        (Some("Archmage"), Some(false))
    );
    let m = c.get_character("1".into()).unwrap();
    assert_eq!((m.price, m.max_supply, m.active), (U128(usd(4)), 10, false));
    c.update_character("1".into(), None, None, Some(0), None);
    assert_eq!(
        c.get_character("1".into()).unwrap().max_supply,
        0,
        "unlimited is always allowed"
    );
    assert!(fails(|| c.update_character(
        "9".into(),
        None,
        None,
        None,
        Some(true)
    )));
    assert!(fails(|| c.update_character(
        "01".into(),
        None,
        None,
        None,
        Some(true)
    )));
    ctx(&alice());
    assert!(fails(|| c.update_character(
        "1".into(),
        None,
        Some(U128(0)),
        None,
        None
    )));
}

#[test]
fn token_id_parsing() {
    assert_eq!(parse_token_id("1"), Some(1));
    assert_eq!(parse_token_id("4294967295"), Some(u32::MAX));
    for bad in ["", "abc", "01", "+1", "-1", "1.0", " 1", "4294967296"] {
        assert_eq!(parse_token_id(bad), None, "{bad:?}");
    }
    assert_eq!(
        parse_token_id("0"),
        Some(0),
        "parsed; callers reject 0 for mint and transfer"
    );
}

#[test]
fn sweep_after_sales() {
    let mut c = with_catalog();
    ctx(&alice());
    assert!(fails(|| c.sweep_to_treasury()), "nothing to sweep");
    c.treasury_balance = usd(4);
    let _ = c.sweep_to_treasury();
    let transfer = calls().into_iter().find(|c| c.1 == "ft_transfer").unwrap();
    assert_eq!(transfer.0, usdc());
    assert_eq!(transfer.2["receiver_id"], treasury().as_str());
    assert_eq!(transfer.2["amount"], usd(4).to_string());
    assert_eq!(c.get_config().treasury_balance, U128(0));
    ctx_callback(PromiseResult::Successful(vec![]));
    c.on_swept(treasury(), U128(usd(4)));
    assert_eq!(
        event("hairto", "treasury_swept").unwrap()["data"]["amount"],
        usd(4).to_string()
    );
    assert_eq!(c.get_config().treasury_balance, U128(0));
}

#[test]
fn failed_sweep_restores_the_balance() {
    let mut c = with_catalog();
    c.treasury_balance = usd(4);
    ctx(&alice());
    let _ = c.sweep_to_treasury();
    ctx_callback(PromiseResult::Failed);
    c.on_swept(treasury(), U128(usd(4)));
    assert!(event("hairto", "treasury_sweep_failed").is_some());
    assert_eq!(c.get_config().treasury_balance, U128(usd(4)));
}

#[test]
fn guardian_pause() {
    let mut c = setup();
    ctx(&alice());
    assert!(fails(|| c.pause()));
    ctx(&guardian());
    c.pause();
    assert!(event("hairto", "shop_paused").is_some());
    assert!(c.get_config().paused);
    // Sweep keeps working while paused.
    c.treasury_balance = 1;
    ctx(&alice());
    let _ = c.sweep_to_treasury();
    ctx(&guardian());
    c.unpause();
    assert!(event("hairto", "shop_unpaused").is_some());
    assert!(!c.get_config().paused);
}
