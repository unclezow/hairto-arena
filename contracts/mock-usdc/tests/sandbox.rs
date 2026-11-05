//! Integration tests on a local sandbox node: faucet from a fresh account, transfers, `ft_transfer_call` against a
//! mock receiver, and the minter path.
//!
//! Run with `cargo test -p mock-usdc --test sandbox -- --nocapture` to see the gas report.

mod common;

use common::*;
use near_api::NearToken;
use serde_json::{json, Value};

fn one_yocto() -> NearToken {
    NearToken::from_yoctonear(1)
}

#[tokio::test]
async fn faucet_and_transfers() {
    let env = Env::new().await;
    let (alice, bob, carol) = (env.alice.clone(), env.bob.clone(), env.carol.clone());

    let bounds: Value = env
        .view(&env.usdc, "storage_balance_bounds", json!({}))
        .await;
    let min: u128 = bounds["min"].as_str().unwrap().parse().unwrap();
    assert_eq!(
        min, 1_250_000_000_000_000_000_000,
        "0.00125 NEAR per account"
    );

    // Fresh account, 0.01 NEAR attached: registered, 1 000 USDC, the rest refunded.
    let before = env.near_balance(&alice).await;
    let faucet = env
        .call(&alice, "faucet", json!({}), NearToken::from_millinear(10))
        .await;
    assert!(is_ok(&faucet), "{faucet:?}");
    assert!(event(&faucet, "nep141", "ft_mint").is_some());
    assert!(event(&faucet, "hairto", "faucet_claimed").is_some());
    let spent = before - env.near_balance(&alice).await;
    let gas_cost = faucet
        .outcomes()
        .iter()
        .map(|o| o.tokens_burnt.as_yoctonear())
        .sum::<u128>();
    assert!(spent >= min, "storage minimum kept");
    assert!(
        spent <= min + gas_cost,
        "excess deposit refunded (spent {spent})"
    );
    assert_eq!(env.balance(&alice).await, 1_000 * ONE_USDC);
    let storage: Option<Value> = env
        .view(
            &env.usdc,
            "storage_balance_of",
            json!({ "account_id": alice }),
        )
        .await;
    assert!(storage.is_some());

    // Cooldown.
    let again = env
        .call(&alice, "faucet", json!({}), NearToken::from_yoctonear(0))
        .await;
    assert!(!is_ok(&again));
    let info: Value = env
        .view(&env.usdc, "faucet_info", json!({ "account_id": carol }))
        .await;
    assert_eq!(info["next_claim_ms"], 0);

    // Unregistered without deposit.
    let res = env
        .call(&carol, "faucet", json!({}), NearToken::from_yoctonear(0))
        .await;
    assert!(!is_ok(&res));

    // Transfer to a registered account.
    env.register(&bob).await;
    let transfer = env
        .call(
            &alice,
            "ft_transfer",
            json!({ "receiver_id": bob, "amount": (20 * ONE_USDC).to_string() }),
            one_yocto(),
        )
        .await;
    assert!(is_ok(&transfer), "{transfer:?}");
    assert!(event(&transfer, "nep141", "ft_transfer").is_some());
    assert_eq!(env.balance(&alice).await, 980 * ONE_USDC);
    assert_eq!(env.balance(&bob).await, 20 * ONE_USDC);

    // Transfer to an unregistered account fails and changes nothing.
    let res = env
        .call(
            &alice,
            "ft_transfer",
            json!({ "receiver_id": carol, "amount": ONE_USDC.to_string() }),
            one_yocto(),
        )
        .await;
    assert!(!is_ok(&res));
    assert_eq!(env.balance(&alice).await, 980 * ONE_USDC);
    let supply: String = env.view(&env.usdc, "ft_total_supply", json!({})).await;
    assert_eq!(supply, (1_000 * ONE_USDC).to_string());

    let metadata: Value = env.view(&env.usdc, "ft_metadata", json!({})).await;
    assert_eq!(metadata["symbol"], "USDC");
    assert_eq!(metadata["decimals"], 6);

    println!(
        "GAS faucet={:.2} Tgas (with registration), ft_transfer={:.2} Tgas",
        tgas(&faucet),
        tgas(&transfer)
    );
}

#[tokio::test]
async fn transfer_call_accept_and_refund() {
    let env = Env::new().await;
    let (alice, receiver) = (env.alice.clone(), env.receiver.clone());
    let res = env
        .call(&alice, "faucet", json!({}), NearToken::from_millinear(10))
        .await;
    assert!(is_ok(&res));
    env.register(&receiver).await;

    let send = |msg: &'static str, amount: u128| {
        let env = &env;
        let alice = alice.clone();
        let receiver = receiver.clone();
        async move {
            env.call(
                &alice,
                "ft_transfer_call",
                json!({ "receiver_id": receiver, "amount": amount.to_string(), "msg": msg }),
                one_yocto(),
            )
            .await
        }
    };

    // Accept: the receiver keeps everything.
    let accept = send("accept", 100 * ONE_USDC).await;
    assert!(is_ok(&accept), "{accept:?}");
    assert_eq!(
        accept.clone().json::<String>().unwrap(),
        (100 * ONE_USDC).to_string()
    );
    assert_eq!(env.balance(&receiver).await, 100 * ONE_USDC);
    assert_eq!(env.balance(&alice).await, 900 * ONE_USDC);

    // Refund: the full amount comes back to the sender.
    let refund = send("refund", 50 * ONE_USDC).await;
    assert!(is_ok(&refund));
    assert_eq!(refund.clone().json::<String>().unwrap(), "0");
    assert_eq!(env.balance(&alice).await, 900 * ONE_USDC);
    assert_eq!(env.balance(&receiver).await, 100 * ONE_USDC);

    // Half: half is used.
    let half = send("half", 10 * ONE_USDC).await;
    assert!(is_ok(&half));
    assert_eq!(env.balance(&alice).await, 895 * ONE_USDC);

    // Receiver panics: everything is refunded.
    let panics = send("boom", 10 * ONE_USDC).await;
    assert!(!panics.receipt_failures().is_empty());
    assert_eq!(env.balance(&alice).await, 895 * ONE_USDC);
    assert_eq!(env.balance(&receiver).await, 105 * ONE_USDC);

    let kept: String = env.view(&receiver, "received", json!({})).await;
    assert_eq!(kept, (105 * ONE_USDC).to_string());

    println!("GAS ft_transfer_call={:.2} Tgas (accept)", tgas(&accept));
}

#[tokio::test]
async fn minter_path() {
    let env = Env::new().await;
    let (owner, vault, alice) = (env.owner.clone(), env.vault.clone(), env.alice.clone());
    env.register(&vault).await;
    let zero = NearToken::from_yoctonear(0);

    let mint =
        json!({ "account_id": vault, "amount": (5 * ONE_USDC).to_string(), "memo": "yield" });
    assert!(
        !is_ok(&env.call(&vault, "mint", mint.clone(), zero).await),
        "not a minter yet"
    );

    let added = env
        .call(&owner, "add_minter", json!({ "account_id": vault }), zero)
        .await;
    assert!(is_ok(&added));
    assert!(event(&added, "hairto", "minter_added").is_some());

    let minted = env.call(&vault, "mint", mint.clone(), zero).await;
    assert!(is_ok(&minted), "{minted:?}");
    assert_eq!(env.balance(&vault).await, 5 * ONE_USDC);
    let supply: String = env.view(&env.usdc, "ft_total_supply", json!({})).await;
    assert_eq!(supply, (5 * ONE_USDC).to_string());

    assert!(
        !is_ok(&env.call(&alice, "mint", mint.clone(), zero).await),
        "stranger"
    );
    assert!(!is_ok(
        &env.call(&alice, "add_minter", json!({ "account_id": alice }), zero)
            .await
    ));

    let removed = env
        .call(
            &owner,
            "remove_minter",
            json!({ "account_id": vault }),
            zero,
        )
        .await;
    assert!(event(&removed, "hairto", "minter_removed").is_some());
    assert!(!is_ok(&env.call(&vault, "mint", mint, zero).await));
}
