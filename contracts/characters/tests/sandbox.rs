//! Integration tests with the real `mock-usdc` and `mock-mt-receiver`: USDC purchases, transfers, equip and fallback,
//! transfer-call in every receiver mode, and the treasury sweep.
//!
//! Run with `cargo test -p characters --test sandbox -- --nocapture` to see the gas and storage report.

mod common;

use common::*;
use serde_json::json;

#[tokio::test]
async fn purchases_transfers_and_equip() {
    let env = Env::new().await;
    let (alice, bob, shop) = (env.alice.clone(), env.bob.clone(), env.shop.clone());

    // Exact payment.
    let before = env.storage_usage(&shop).await;
    let exact = env.buy(&alice, "2", 2 * USDC).await;
    assert!(is_ok(&exact), "{exact:?}");
    assert!(event(&exact, "mt_mint").is_some() && event(&exact, "character_purchased").is_some());
    let storage = env.storage_usage(&shop).await - before;
    assert_eq!(env.copies(&alice, "2").await, 1);
    assert_eq!(env.usdc_balance(&alice).await, 998 * USDC);

    // Overpayment is refunded by the token.
    let over = env.buy(&alice, "1", 3 * USDC).await;
    assert_eq!(
        over.clone().json::<String>().unwrap(),
        USDC.to_string(),
        "only the price is used"
    );
    assert_eq!(env.usdc_balance(&alice).await, 997 * USDC);

    // Underpaid, already owned, unknown: everything comes back.
    for (id, amount, reason) in [
        ("3", USDC, "underpaid"),
        ("2", 2 * USDC, "already_owned"),
        ("0", USDC, "not_for_sale"),
    ] {
        let res = env.buy(&alice, id, amount).await;
        assert_eq!(
            event(&res, "purchase_rejected").unwrap()["data"]["reason"],
            reason
        );
    }
    assert_eq!(env.usdc_balance(&alice).await, 997 * USDC);

    // Paused shop refunds, equip still works.
    let _ = env
        .ok(&shop, &env.owner, "pause", json!({}), yocto(0))
        .await;
    let res = env.buy(&bob, "1", USDC).await;
    assert_eq!(
        event(&res, "purchase_rejected").unwrap()["data"]["reason"],
        "paused"
    );
    assert_eq!(env.usdc_balance(&bob).await, 1_000 * USDC);
    let _ = env
        .ok(&shop, &alice, "equip", json!({ "token_id": "2" }), yocto(0))
        .await;
    assert_eq!(env.equipped(&alice).await, "2");
    let _ = env
        .ok(&shop, &env.owner, "unpause", json!({}), yocto(0))
        .await;

    // Transferring the equipped copy falls back to the default.
    let transfer = env.transfer(&alice, &bob, "2").await;
    assert!(is_ok(&transfer), "{transfer:?}");
    assert_eq!(
        event(&transfer, "character_equipped").unwrap()["data"]["token_id"],
        "0"
    );
    assert_eq!(env.equipped(&alice).await, "0");
    assert_eq!(
        (env.copies(&alice, "2").await, env.copies(&bob, "2").await),
        (0, 1)
    );
    assert!(
        !is_ok(
            &env.call(
                &shop,
                &alice,
                "mt_transfer",
                json!({ "receiver_id": bob, "token_id": "1", "amount": "1" }),
                yocto(0)
            )
            .await
        ),
        "needs 1 yocto"
    );

    let config: serde_json::Value = env.view(&shop, "get_config", json!({})).await;
    assert_eq!(config["treasury_balance"], (3 * USDC).to_string());
    assert_eq!(env.usdc_balance(&shop).await, 3 * USDC);
    println!(
        "GAS purchase(ft_transfer_call)={:.2} Tgas, mt_transfer={:.2} Tgas",
        tgas(&exact),
        tgas(&transfer)
    );
    println!("STORAGE purchase={storage} bytes");
}

#[tokio::test]
async fn transfer_call_in_every_receiver_mode() {
    let env = Env::new().await;
    let (alice, bob, shop, receiver) = (
        env.alice.clone(),
        env.bob.clone(),
        env.shop.clone(),
        env.receiver.clone(),
    );
    for (id, price) in [("1", 1), ("2", 2), ("3", 3)] {
        assert!(is_ok(&env.buy(&alice, id, price * USDC).await));
    }
    let send = |ids: Vec<&'static str>| {
        let env = &env;
        let alice = alice.clone();
        let receiver = receiver.clone();
        async move {
            let amounts: Vec<&str> = ids.iter().map(|_| "1").collect();
            env.call(
                &env.shop,
                &alice,
                "mt_batch_transfer_call",
                json!({ "receiver_id": receiver, "token_ids": ids, "amounts": amounts, "approvals": null, "memo": null, "msg": "play" }),
                yocto(1),
            )
            .await
        }
    };

    // Keep all.
    env.set_receiver_mode("KeepAll", None).await;
    let keep = send(vec!["1"]).await;
    assert_eq!(keep.clone().json::<Vec<String>>().unwrap(), vec!["1"]);
    assert_eq!(
        (
            env.copies(&alice, "1").await,
            env.copies(&receiver, "1").await
        ),
        (0, 1)
    );

    // Return all.
    env.set_receiver_mode("ReturnAll", None).await;
    let back = send(vec!["2"]).await;
    assert_eq!(back.clone().json::<Vec<String>>().unwrap(), vec!["0"]);
    assert_eq!(env.copies(&alice, "2").await, 1);

    // Return part: the first id comes back, the second is kept.
    env.set_receiver_mode("ReturnPart", None).await;
    let part = send(vec!["2", "3"]).await;
    assert_eq!(part.clone().json::<Vec<String>>().unwrap(), vec!["0", "1"]);
    assert_eq!(
        (env.copies(&alice, "2").await, env.copies(&alice, "3").await),
        (1, 0)
    );
    assert_eq!(env.copies(&receiver, "3").await, 1);

    // Panic: everything comes back.
    env.set_receiver_mode("Panic", None).await;
    let panic = send(vec!["2"]).await;
    assert!(!panic.receipt_failures().is_empty());
    assert_eq!(env.copies(&alice, "2").await, 1);

    // Forward on: the receiver moves the copy to Bob and claims it is unused; nothing can be refunded.
    env.set_receiver_mode("ForwardOn", Some(&bob)).await;
    let forward = send(vec!["2"]).await;
    assert!(is_ok(&forward), "{forward:?}");
    assert_eq!(
        forward.clone().json::<Vec<String>>().unwrap(),
        vec!["1"],
        "kept, because it was moved on"
    );
    assert_eq!(
        (
            env.copies(&alice, "2").await,
            env.copies(&receiver, "2").await,
            env.copies(&bob, "2").await
        ),
        (0, 0, 1)
    );

    let supply: Vec<Option<String>> = env
        .view(
            &shop,
            "mt_batch_supply",
            json!({ "token_ids": ["1", "2", "3", "9"] }),
        )
        .await;
    assert_eq!(
        supply,
        vec![Some("1".into()), Some("1".into()), Some("1".into()), None]
    );
    println!("GAS mt_transfer_call (keep all)={:.2} Tgas", tgas(&keep));
}

#[tokio::test]
async fn sweep_to_treasury() {
    let env = Env::new().await;
    let (alice, shop) = (env.alice.clone(), env.shop.clone());
    assert!(is_ok(&env.buy(&alice, "2", 2 * USDC).await));
    assert!(is_ok(&env.buy(&env.bob.clone(), "2", 2 * USDC).await));

    // The treasury is not registered with USDC yet: the balance is restored.
    let failed = env
        .ok(&shop, &alice, "sweep_to_treasury", json!({}), yocto(0))
        .await;
    assert!(
        event(&failed, "treasury_sweep_failed").is_some(),
        "{failed:?}"
    );
    let config: serde_json::Value = env.view(&shop, "get_config", json!({})).await;
    assert_eq!(config["treasury_balance"], (4 * USDC).to_string());

    let _ = env
        .ok(
            &env.usdc,
            &env.owner,
            "storage_deposit",
            json!({ "account_id": env.treasury }),
            near_api::NearToken::from_millinear(10),
        )
        .await;
    let swept = env
        .ok(&shop, &alice, "sweep_to_treasury", json!({}), yocto(0))
        .await;
    assert_eq!(
        event(&swept, "treasury_swept").unwrap()["data"]["amount"],
        (4 * USDC).to_string()
    );
    assert_eq!(env.usdc_balance(&env.treasury).await, 4 * USDC);
    let config: serde_json::Value = env.view(&shop, "get_config", json!({})).await;
    assert_eq!(config["treasury_balance"], "0");
    assert!(
        !is_ok(
            &env.call(&shop, &alice, "sweep_to_treasury", json!({}), yocto(0))
                .await
        ),
        "nothing left"
    );
}
