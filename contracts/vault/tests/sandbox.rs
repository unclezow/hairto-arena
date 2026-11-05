//! Integration tests with the real `mock-usdc` token and `mock-arena`: deposits through `ft_transfer_call`,
//! accelerated yield, harvest to treasury and arena, Backer claims, withdrawals, rejections, failure recovery, and a
//! randomized no-loss invariant test.
//!
//! Run with `cargo test -p vault --test sandbox -- --nocapture` to see the gas report.

mod common;

use common::*;
use serde_json::{json, Value};

#[tokio::test]
async fn happy_path() {
    let env = Env::new().await;
    let (f, b) = (env.fighters[0].clone(), env.backers[0].clone());

    let dep_f = env.deposit(&f, usd(100), FIGHTER).await;
    assert!(is_ok(&dep_f), "{dep_f:?}");
    assert!(event(&dep_f, "vault_deposited").is_some());
    assert!(is_ok(&env.deposit(&b, usd(500), BACKER).await));
    assert_eq!(env.usdc_balance(&f).await, usd(900));
    assert!(
        env.view::<bool>(&env.vault, "can_play", json!({ "account_id": f }))
            .await
    );
    assert!(
        env.view::<bool>(&env.vault, "can_pick", json!({ "account_id": b }))
            .await
    );
    assert_eq!(
        env.view::<Option<String>>(&env.vault, "role_of", json!({ "account_id": b }))
            .await
            .as_deref(),
        Some("Backer")
    );

    // A second of block time is about 11.6 days of yield.
    env.set_multiplier(1_000_000).await;
    env.sandbox.fast_forward(10).await.unwrap();
    let live = env.totals().await;
    assert!(
        amount(&live["pending_pot"]) > 0,
        "live pending values: {live}"
    );

    let harvest = env
        .ok(&env.vault, &env.owner, "harvest", json!({}), yocto(0))
        .await;
    assert!(event(&harvest, "vault_harvested").is_some());
    let fee_paid = amount(&event(&harvest, "vault_fee_paid").unwrap()["data"]["amount"]);
    let pot_funded = amount(&event(&harvest, "vault_pot_funded").unwrap()["data"]["amount"]);
    assert_eq!(env.usdc_balance(&env.treasury).await, fee_paid);
    assert_eq!(env.pot_received().await, pot_funded);
    assert_eq!(env.usdc_balance(&env.arena).await, pot_funded);
    assert!(fee_paid > 0 && pot_funded > fee_paid);
    env.assert_no_loss("after harvest").await;

    let claim = env
        .ok(&env.vault, &b, "claim_yield", json!({}), yocto(1))
        .await;
    let claimed = amount(&event(&claim, "vault_yield_claimed").unwrap()["data"]["amount"]);
    assert!(claimed > 0);
    assert_eq!(env.usdc_balance(&b).await, usd(500) + claimed);

    // Stop the yield so the exit leaves nothing owed, then leave both pools.
    let _ = env
        .ok(
            &env.vault,
            &env.owner,
            "set_apy_bps",
            json!({ "apy_bps": 0 }),
            yocto(0),
        )
        .await;
    let wf = env.withdraw(&f, "Fighter", usd(100)).await;
    assert!(is_ok(&wf), "{wf:?}");
    assert!(event(&wf, "vault_role_released").is_some());
    assert_eq!(env.usdc_balance(&f).await, usd(1_000));
    let wb = env.withdraw(&b, "Backer", usd(500)).await;
    assert!(event(&wb, "vault_withdrawn").is_some());
    if event(&wb, "vault_role_released").is_none() {
        // Yield accrued between the claim and the rate change; claim it to finish the exit.
        let last = env
            .ok(&env.vault, &b, "claim_yield", json!({}), yocto(1))
            .await;
        assert!(event(&last, "vault_role_released").is_some());
    }
    assert!(env
        .view::<Option<String>>(&env.vault, "role_of", json!({ "account_id": b }))
        .await
        .is_none());
    env.assert_no_loss("after exits").await;

    println!(
        "GAS deposit(ft_transfer_call)={:.2} Tgas, withdraw={:.2} Tgas, harvest={:.2} Tgas, claim_yield={:.2} Tgas",
        tgas(&dep_f),
        tgas(&wf),
        tgas(&harvest),
        tgas(&claim)
    );
}

#[tokio::test]
async fn rejections_return_tokens() {
    let env = Env::new().await;
    let (f, b) = (env.fighters[0].clone(), env.backers[0].clone());
    let reason = |res: &near_api::types::transaction::result::ExecutionFinalResult| {
        event(res, "vault_deposit_rejected")
            .map(|e| e["data"]["reason"].as_str().unwrap().to_string())
    };

    let res = env.deposit(&f, usd(5), FIGHTER).await;
    assert_eq!(reason(&res).as_deref(), Some("below_minimum"));
    assert_eq!(res.clone().json::<String>().unwrap(), "0", "nothing used");

    assert!(is_ok(&env.deposit(&b, usd(100), BACKER).await));
    let res = env.deposit(&b, usd(50), FIGHTER).await;
    assert_eq!(reason(&res).as_deref(), Some("role_conflict"));

    let res = env.deposit(&f, usd(20), "not json").await;
    assert_eq!(reason(&res).as_deref(), Some("bad_msg"));

    // An account registered with USDC but not with the vault.
    let stranger = env.treasury.clone();
    let _ = env
        .ok(
            &env.vault,
            &env.owner,
            "set_treasury",
            json!({ "treasury_id": env.owner }),
            yocto(0),
        )
        .await;
    let _ = env
        .ok(
            &env.usdc,
            &env.owner,
            "add_minter",
            json!({ "account_id": env.owner }),
            yocto(0),
        )
        .await;
    let _ = env
        .ok(
            &env.usdc,
            &env.owner,
            "mint",
            json!({ "account_id": stranger, "amount": usd(20).to_string() }),
            yocto(0),
        )
        .await;
    let res = env.deposit(&stranger, usd(20), FIGHTER).await;
    assert_eq!(reason(&res).as_deref(), Some("not_registered"));
    assert_eq!(env.usdc_balance(&stranger).await, usd(20));

    let _ = env
        .ok(&env.vault, &env.owner, "pause", json!({}), yocto(0))
        .await;
    let res = env.deposit(&f, usd(20), FIGHTER).await;
    assert_eq!(reason(&res).as_deref(), Some("paused"));
    let _ = env
        .ok(&env.vault, &env.owner, "unpause", json!({}), yocto(0))
        .await;

    assert_eq!(env.usdc_balance(&f).await, usd(1_000));
    assert_eq!(env.usdc_balance(&b).await, usd(900));

    // A foreign token: the vault panics and the token refunds.
    let fake: near_api::AccountId = "fake-usdc.sandbox".parse().unwrap();
    env.sandbox
        .create_account(fake.as_str().parse().unwrap())
        .initial_balance(near_api::NearToken::from_near(10))
        .send()
        .await
        .unwrap();
    near_api::Contract::deploy(fake.clone())
        .use_code(wasms()[1].clone())
        .with_init_call("new", json!({ "owner_id": env.owner }))
        .unwrap()
        .with_signer(env.signer.clone())
        .send_to(&env.net)
        .await
        .unwrap()
        .assert_success();
    let _ = env
        .ok(
            &fake,
            &f,
            "faucet",
            json!({}),
            near_api::NearToken::from_millinear(10),
        )
        .await;
    let _ = env
        .ok(
            &fake,
            &env.owner,
            "storage_deposit",
            json!({ "account_id": env.vault }),
            near_api::NearToken::from_millinear(10),
        )
        .await;
    let res = env
        .call(
            &fake,
            &f,
            "ft_transfer_call",
            json!({ "receiver_id": env.vault, "amount": usd(50).to_string(), "msg": FIGHTER }),
            yocto(1),
        )
        .await;
    assert!(
        !res.receipt_failures().is_empty(),
        "the vault rejects the foreign token"
    );
    let fake_balance: String = env
        .view(&fake, "ft_balance_of", json!({ "account_id": f }))
        .await;
    assert_eq!(fake_balance, usd(1_000).to_string());
    assert_eq!(env.principal(&f, "Fighter").await, 0);

    // Second init fails.
    let res = env
        .call(
            &env.vault,
            &env.owner,
            "new",
            json!({ "owner_id": f, "token_id": fake, "arena_id": f, "treasury_id": f, "demo_mode": false }),
            yocto(0),
        )
        .await;
    assert!(!is_ok(&res));
    let config: Value = env.view(&env.vault, "get_config", json!({})).await;
    assert_eq!(config["token_id"], env.usdc.as_str());
}

#[tokio::test]
async fn failures_recover() {
    let env = Env::new().await;
    let (f, f2) = (env.fighters[0].clone(), env.fighters[1].clone());
    assert!(is_ok(&env.deposit(&f, usd(500), FIGHTER).await));
    env.set_multiplier(1_000_000).await;
    env.sandbox.fast_forward(10).await.unwrap();

    // The arena returns the pot: it stays in the vault and is sent again by flush_payouts.
    env.set_arena_mode("ReturnAll").await;
    let harvest = env
        .ok(&env.vault, &env.owner, "harvest", json!({}), yocto(0))
        .await;
    let failed = event(&harvest, "vault_payout_failed").unwrap();
    assert_eq!(failed["data"]["kind"], "pot_returned");
    let held = amount(&env.totals().await["pot_held"]);
    assert!(held > 0);
    assert_eq!(env.pot_received().await, 0);
    env.assert_no_loss("pot returned").await;

    env.set_arena_mode("Accept").await;
    let flush = env
        .ok(&env.vault, &env.owner, "flush_payouts", json!({}), yocto(0))
        .await;
    assert_eq!(
        amount(&event(&flush, "vault_pot_funded").unwrap()["data"]["amount"]),
        held
    );
    assert_eq!(env.pot_received().await, held);
    assert_eq!(amount(&env.totals().await["pot_held"]), 0);

    // The arena panics: the token refunds and the vault holds the pot again.
    env.set_arena_mode("Panic").await;
    env.sandbox.fast_forward(5).await.unwrap();
    let harvest = env
        .ok(&env.vault, &env.owner, "harvest", json!({}), yocto(0))
        .await;
    assert!(event(&harvest, "vault_payout_failed").is_some());
    assert!(amount(&env.totals().await["pot_held"]) > 0);
    env.assert_no_loss("arena panicked").await;

    // A withdrawal to an account that left the token restores principal.
    assert!(is_ok(&env.deposit(&f2, usd(1_000), FIGHTER).await));
    let _ = env
        .ok(&env.usdc, &f2, "storage_unregister", json!({}), yocto(1))
        .await;
    let res = env.withdraw(&f2, "Fighter", usd(100)).await;
    assert!(event(&res, "vault_withdraw_failed").is_some(), "{res:?}");
    assert_eq!(env.principal(&f2, "Fighter").await, usd(1_000));
    env.assert_no_loss("withdraw failed").await;
    // After registering again with the token, the withdrawal works.
    let _ = env
        .ok(
            &env.usdc,
            &f2,
            "storage_deposit",
            json!({}),
            near_api::NearToken::from_millinear(10),
        )
        .await;
    let res = env.withdraw(&f2, "Fighter", usd(100)).await;
    assert!(event(&res, "vault_withdrawn").is_some());
    assert_eq!(env.usdc_balance(&f2).await, usd(100));
}

/// Deterministic pseudo-random sequence (64-bit LCG).
struct Lcg(u64);

impl Lcg {
    fn next(&mut self, n: u64) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (self.0 >> 33) % n
    }
}

#[tokio::test]
async fn randomized_no_loss_invariant() {
    let env = Env::new().await;
    let mut rng = Lcg(2026);
    let users: Vec<(near_api::AccountId, &str, &str)> = vec![
        (env.fighters[0].clone(), "Fighter", FIGHTER),
        (env.fighters[1].clone(), "Fighter", FIGHTER),
        (env.backers[0].clone(), "Backer", BACKER),
        (env.backers[1].clone(), "Backer", BACKER),
    ];
    env.set_multiplier(100_000).await;
    for step in 0..40 {
        let label;
        match rng.next(8) {
            0..=2 => {
                let (who, _, msg) = &users[rng.next(4) as usize];
                let amt = usd(10 + u128::from(rng.next(200)));
                let _ = env.deposit(who, amt, msg).await;
                label = format!("deposit {amt} by {who}");
            }
            3 | 4 => {
                let (who, pool, _) = &users[rng.next(4) as usize];
                let p = env.principal(who, pool).await;
                if p > 0 {
                    let amt = 1 + u128::from(rng.next(u64::try_from(p).unwrap()));
                    let res = env.withdraw(who, pool, amt).await;
                    assert!(
                        event(&res, "vault_withdrawn").is_some(),
                        "withdraw: {res:?}"
                    );
                }
                label = format!("withdraw by {who}");
            }
            5 => {
                let _ = env
                    .call(&env.vault, &env.owner, "harvest", json!({}), yocto(0))
                    .await;
                label = "harvest".into();
            }
            6 => {
                let mode = ["Accept", "ReturnAll", "Panic"][rng.next(3) as usize];
                env.set_arena_mode(mode).await;
                let _ = env
                    .call(&env.vault, &env.owner, "flush_payouts", json!({}), yocto(0))
                    .await;
                label = format!("flush with arena {mode}");
            }
            _ => {
                let (who, _, _) = &users[2 + rng.next(2) as usize];
                let _ = env
                    .call(&env.vault, who, "claim_yield", json!({}), yocto(1))
                    .await;
                if rng.next(2) == 0 {
                    env.set_multiplier(1 + rng.next(200_000) as u32).await;
                }
                label = format!("claim by {who}");
            }
        }
        env.assert_no_loss(&format!("step {step}: {label}")).await;
    }
    // Everyone can still withdraw their full principal in one call.
    for (who, pool, _) in &users {
        let p = env.principal(who, pool).await;
        if p > 0 {
            let res = env.withdraw(who, pool, p).await;
            assert!(
                event(&res, "vault_withdrawn").is_some(),
                "full exit of {who}"
            );
        }
    }
    env.assert_no_loss("after full exits").await;
}
