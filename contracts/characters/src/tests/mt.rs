//! `mt-standard` scenarios and the equip fallback after transfers.

use near_sdk::PromiseOrValue;

use super::*;

fn carol() -> AccountId {
    acc("carol.test.near")
}

/// Alice buys characters 1 and 3; character 2 is bought by Bob.
fn holders() -> Characters {
    let mut c = with_catalog();
    for (buyer, id, price) in [(alice(), "1", 1), (alice(), "3", 3), (bob(), "2", 2)] {
        ctx(&usdc());
        let _ = c.ft_on_transfer(buyer, U128(usd(price)), format!(r#"{{"buy":"{id}"}}"#));
    }
    c
}

fn bal(c: &Characters, who: &AccountId, id: &str) -> u128 {
    c.mt_balance_of(who.clone(), id.into()).0
}

fn transfer(c: &mut Characters, from: &AccountId, to: &AccountId, id: &str) {
    ctx_yocto(from);
    c.mt_transfer(to.clone(), id.into(), U128(1), None, None);
}

#[test]
fn transfer_one_copy() {
    let mut c = holders();
    transfer(&mut c, &alice(), &bob(), "1");
    let logs: Vec<_> = events()
        .into_iter()
        .filter(|e| e["event"] == "mt_transfer")
        .collect();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0]["standard"], "nep245");
    assert_eq!(logs[0]["data"][0]["old_owner_id"], alice().as_str());
    assert_eq!(logs[0]["data"][0]["token_ids"][0], "1");
    assert_eq!((bal(&c, &alice(), "1"), bal(&c, &bob(), "1")), (0, 1));
    assert!(
        !c.balances.contains_key(&(1, alice())),
        "emptied entries are deleted"
    );
    // Transfers ignore the one-copy rule: Bob can receive a second copy.
    ctx_yocto(&bob());
    c.mt_transfer(alice(), "1".into(), U128(1), None, None);
    transfer(&mut c, &alice(), &bob(), "1");
    assert_eq!(bal(&c, &bob(), "1"), 1);
}

#[test]
fn transfer_checks() {
    let mut c = holders();
    for id in ["abc", "0", "9", "01"] {
        assert!(fails(|| transfer(&mut c, &alice(), &bob(), id)), "{id}");
    }
    ctx(&alice());
    assert!(
        fails(|| c.mt_transfer(bob(), "1".into(), U128(1), None, None)),
        "no yoctoNEAR"
    );
    testing_env!(builder(&alice(), NearToken::from_yoctonear(2)).build());
    assert!(
        fails(|| c.mt_transfer(bob(), "1".into(), U128(1), None, None)),
        "2 yoctoNEAR"
    );
    ctx_yocto(&alice());
    assert!(
        fails(|| c.mt_transfer(alice(), "1".into(), U128(1), None, None)),
        "to self"
    );
    assert!(
        fails(|| c.mt_transfer(bob(), "1".into(), U128(0), None, None)),
        "zero"
    );
    assert!(
        fails(|| c.mt_transfer(bob(), "1".into(), U128(2), None, None)),
        "more than held"
    );
    assert!(
        fails(|| c.mt_transfer(bob(), "2".into(), U128(1), None, None)),
        "not held"
    );
    assert!(
        fails(|| c.mt_transfer(bob(), "1".into(), U128(1), Some((carol(), 1)), None)),
        "approval"
    );
}

#[test]
fn batch_transfer() {
    let mut c = holders();
    ctx_yocto(&alice());
    assert!(
        fails(|| c.mt_batch_transfer(
            bob(),
            vec!["1".into(), "3".into()],
            vec![U128(1)],
            None,
            None
        )),
        "length mismatch"
    );
    assert!(
        fails(|| c.mt_batch_transfer(bob(), vec![], vec![], None, None)),
        "empty"
    );
    assert!(fails(|| c.mt_batch_transfer(
        bob(),
        vec!["1".into()],
        vec![U128(1)],
        Some(vec![None, None]),
        None
    )));
    assert!(fails(|| c.mt_batch_transfer(
        bob(),
        vec!["1".into()],
        vec![U128(1)],
        Some(vec![Some((carol(), 1))]),
        None
    )));
    c.mt_batch_transfer(
        bob(),
        vec!["1".into(), "3".into()],
        vec![U128(1), U128(1)],
        Some(vec![None, None]),
        Some("gift".into()),
    );
    let logs: Vec<_> = events()
        .into_iter()
        .filter(|e| e["event"] == "mt_transfer")
        .collect();
    assert_eq!(logs.len(), 1);
    assert_eq!(
        logs[0]["data"][0]["token_ids"],
        serde_json::json!(["1", "3"])
    );
    assert_eq!(logs[0]["data"][0]["memo"], "gift");
    assert_eq!(
        c.mt_batch_balance_of(bob(), vec!["1".into(), "2".into(), "3".into()]),
        vec![U128(1); 3]
    );
}

#[test]
fn transferring_the_equipped_character_falls_back() {
    let mut c = holders();
    ctx(&alice());
    c.equip("3".into());
    transfer(&mut c, &alice(), &bob(), "1");
    assert!(
        event("hairto", "character_equipped").is_none(),
        "still holds the equipped id"
    );
    transfer(&mut c, &alice(), &bob(), "3");
    let e = event("hairto", "character_equipped").unwrap();
    assert_eq!(
        (
            e["data"]["account_id"].as_str(),
            e["data"]["token_id"].as_str()
        ),
        (Some(alice().as_str()), Some("0"))
    );
    assert_eq!(c.equipped_of(alice()), "0");
    assert!(!c.equipped.contains_key(&alice()));
}

/// `mt_transfer_call` of one copy of `id` from Alice to Carol, then the resolver with `result`.
fn transfer_call(c: &mut Characters, id: &str, result: PromiseResult) -> Vec<u128> {
    ctx_yocto(&alice());
    let _ = c.mt_transfer_call(carol(), id.into(), U128(1), None, None, "play".into());
    let on_transfer = calls()
        .into_iter()
        .find(|x| x.1 == "mt_on_transfer")
        .unwrap();
    assert_eq!(on_transfer.0, carol());
    assert_eq!(on_transfer.2["previous_owner_ids"][0], alice().as_str());
    ctx_callback(result);
    c.mt_resolve_transfer(vec![alice()], carol(), vec![id.into()], vec![U128(1)], None)
        .into_iter()
        .map(|u| u.0)
        .collect()
}

fn unused(amounts: &[&str]) -> PromiseResult {
    PromiseResult::Successful(serde_json::to_vec(amounts).unwrap())
}

#[test]
fn receiver_keeps_everything() {
    let mut c = holders();
    assert_eq!(transfer_call(&mut c, "1", unused(&["0"])), vec![1]);
    assert!(
        events().iter().all(|e| e["event"] != "mt_transfer"),
        "no refund"
    );
    assert_eq!((bal(&c, &alice(), "1"), bal(&c, &carol(), "1")), (0, 1));
}

#[test]
fn receiver_returns_everything() {
    let mut c = holders();
    assert_eq!(transfer_call(&mut c, "1", unused(&["1"])), vec![0]);
    let refund = event("nep245", "mt_transfer").unwrap();
    assert_eq!(refund["data"][0]["old_owner_id"], carol().as_str());
    assert_eq!(refund["data"][0]["new_owner_id"], alice().as_str());
    assert_eq!((bal(&c, &alice(), "1"), bal(&c, &carol(), "1")), (1, 0));
}

#[test]
fn receiver_panics_or_answers_badly() {
    for result in [
        PromiseResult::Failed,
        PromiseResult::Successful(b"nonsense".to_vec()),
        unused(&["1", "0"]),
    ] {
        let mut c = holders();
        assert_eq!(transfer_call(&mut c, "1", result), vec![0]);
        assert_eq!(bal(&c, &alice(), "1"), 1, "copy back to the sender");
    }
    // An unused amount above what was sent is capped.
    let mut c = holders();
    assert_eq!(transfer_call(&mut c, "1", unused(&["5"])), vec![0]);
    assert_eq!(bal(&c, &alice(), "1"), 1);
}

#[test]
fn refund_limited_to_what_the_receiver_still_holds() {
    let mut c = holders();
    ctx_yocto(&alice());
    let _ = c.mt_transfer_call(carol(), "1".into(), U128(1), None, None, String::new());
    // The receiver forwards the copy before answering that everything is unused.
    transfer(&mut c, &carol(), &bob(), "1");
    ctx_callback(unused(&["1"]));
    let kept = c.mt_resolve_transfer(
        vec![alice()],
        carol(),
        vec!["1".into()],
        vec![U128(1)],
        None,
    );
    assert_eq!(kept, vec![U128(1)]);
    assert_eq!(
        (
            bal(&c, &alice(), "1"),
            bal(&c, &carol(), "1"),
            bal(&c, &bob(), "1")
        ),
        (0, 0, 1)
    );
}

#[test]
fn fallback_waits_for_the_resolver() {
    // Refunded: the equipped character stays.
    let mut c = holders();
    ctx(&alice());
    c.equip("3".into());
    transfer_call(&mut c, "3", unused(&["1"]));
    assert_eq!(c.equipped_of(alice()), "3");
    assert!(event("hairto", "character_equipped").is_none());
    // Kept by the receiver: back to the default after resolution.
    transfer_call(&mut c, "3", unused(&["0"]));
    assert_eq!(
        event("hairto", "character_equipped").unwrap()["data"]["token_id"],
        "0"
    );
    assert_eq!(c.equipped_of(alice()), "0");
}

#[test]
fn transfer_call_checks() {
    let mut c = holders();
    testing_env!({
        let mut b = builder(&alice(), NearToken::from_yoctonear(1));
        b.prepaid_gas(Gas::from_tgas(49));
        b.build()
    });
    assert!(
        fails(|| c.mt_transfer_call(carol(), "1".into(), U128(1), None, None, String::new())),
        "gas"
    );
    ctx(&alice());
    assert!(
        fails(|| c.mt_transfer_call(carol(), "1".into(), U128(1), None, None, String::new())),
        "yocto"
    );
    ctx_yocto(&alice());
    assert!(fails(|| c.mt_transfer_call(
        carol(),
        "1".into(),
        U128(1),
        Some((bob(), 1)),
        None,
        String::new()
    )));
    assert!(fails(|| c.mt_batch_transfer_call(
        carol(),
        vec!["1".into()],
        vec![],
        None,
        None,
        String::new()
    )));
    let _ = c.mt_batch_transfer_call(
        carol(),
        vec!["1".into(), "3".into()],
        vec![U128(1), U128(1)],
        None,
        None,
        String::new(),
    );
    ctx_callback(unused(&["0", "1"]));
    let kept = c.mt_resolve_transfer(
        vec![alice(), alice()],
        carol(),
        vec!["1".into(), "3".into()],
        vec![U128(1), U128(1)],
        None,
    );
    assert_eq!(kept, vec![U128(1), U128(0)]);
    assert_eq!(
        c.mt_batch_balance_of(alice(), vec!["1".into(), "3".into()]),
        vec![U128(0), U128(1)]
    );
    ctx_yocto(&alice());
    assert!(matches!(
        c.mt_transfer_call(carol(), "3".into(), U128(1), None, None, String::new()),
        PromiseOrValue::Promise(_)
    ));
}

#[test]
fn balance_and_supply_views() {
    let c = holders();
    assert_eq!(
        c.mt_batch_balance_of(alice(), vec!["1".into(), "2".into()]),
        vec![U128(1), U128(0)]
    );
    assert_eq!(c.mt_balance_of(alice(), "abc".into()), U128(0));
    assert_eq!(c.mt_supply("1".into()), Some(U128(1)));
    assert_eq!(c.mt_supply("4".into()), Some(U128(0)));
    assert_eq!(
        c.mt_batch_supply(vec!["2".into(), "0".into(), "9".into()]),
        vec![Some(U128(1)), None, None]
    );
    let tokens = c.mt_token(vec!["1".into(), "0".into()]);
    assert_eq!(tokens[0].as_ref().unwrap().token_id, "1");
    assert!(tokens[0].as_ref().unwrap().owner_id.is_none());
    assert!(tokens[1].is_none());
}

#[test]
fn metadata_views() {
    let mut c = with_catalog();
    ctx(&owner());
    c.update_character("4".into(), None, None, Some(100), None);
    let contract = c.mt_metadata_contract();
    assert_eq!(
        (contract.spec.as_str(), contract.name.as_str()),
        ("mt-1.0.0", "Hairto Arena Characters")
    );
    let base = c.mt_metadata_base_by_token_id(vec!["1".into(), "4".into(), "0".into()]);
    let mage = base[0].as_ref().unwrap();
    assert_eq!(
        format!(
            "{}/{}",
            mage.base_uri.as_ref().unwrap(),
            mage.reference.as_ref().unwrap()
        ),
        "https://app.example/characters/1.json"
    );
    assert_eq!((mage.name.as_str(), mage.copies), ("Mage", None));
    assert_eq!(base[1].as_ref().unwrap().copies, Some(100));
    assert!(base[2].is_none());
    let token = c.mt_metadata_token_by_token_id(vec!["2".into()]);
    assert_eq!(token[0].as_ref().unwrap().title.as_deref(), Some("Rogue"));
    let all = c.mt_metadata_token_all(vec!["3".into(), "9".into()]);
    assert_eq!(all[0].as_ref().unwrap().base.name, "Rogue (Hooded)");
    assert!(all[1].is_none());
}
