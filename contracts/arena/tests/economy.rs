//! The season economy against the real `vault` and `mock-usdc`: Backer picks, a full season from deposits to
//! rollover, refunds of unexpected pot transfers, the claims pause, and a claim reverted for an account that left the
//! token. `usdc.ft_balance_of(arena) == total_pots` is asserted after every step.
//!
//! Run with `cargo test -p arena --test economy -- --nocapture` to see the gas and storage report.

mod common;

use common::*;
use near_api::types::transaction::result::ExecutionFinalResult;
use near_api::{Account, AccountId, Contract, NearGas, NearToken};
use serde_json::{json, Value};

const USDC: u128 = 1_000_000;

fn yocto(n: u128) -> NearToken {
    NearToken::from_yoctonear(n)
}

fn amount(v: &Value) -> u128 {
    v.as_str().unwrap().parse().unwrap()
}

struct Economy {
    env: Env,
    usdc: AccountId,
    vault: AccountId,
    backer: AccountId,
    backer2: AccountId,
}

impl Economy {
    async fn call(
        &self,
        contract: &AccountId,
        who: &AccountId,
        method: &str,
        args: Value,
        deposit: NearToken,
    ) -> ExecutionFinalResult {
        Contract(contract.clone())
            .call_function(method, args)
            .transaction()
            .gas(NearGas::from_tgas(300))
            .deposit(deposit)
            .with_signer(who.clone(), self.env.signer.clone())
            .send_to(&self.env.net)
            .await
            .expect("transaction sent")
            .into_full()
            .expect("transaction executed")
    }

    async fn ok(
        &self,
        contract: &AccountId,
        who: &AccountId,
        method: &str,
        args: Value,
        deposit: NearToken,
    ) -> ExecutionFinalResult {
        let res = self
            .call(contract, who, method, args.clone(), deposit)
            .await;
        assert!(is_ok(&res), "{method}({args}) failed: {res:?}");
        res
    }

    async fn view_on<T: near_sdk::serde::de::DeserializeOwned + Send + Sync>(
        &self,
        contract: &AccountId,
        method: &str,
        args: Value,
    ) -> T {
        Contract(contract.clone())
            .call_function(method, args)
            .read_only()
            .fetch_from(&self.env.net)
            .await
            .unwrap_or_else(|e| panic!("view {method} failed: {e:?}"))
            .data
    }

    async fn usdc_balance(&self, account: &AccountId) -> u128 {
        let b: String = self
            .view_on(
                &self.usdc,
                "ft_balance_of",
                json!({ "account_id": account }),
            )
            .await;
        b.parse().unwrap()
    }

    async fn assert_pots_held(&self, step: &str) {
        let total: String = self.env.view("total_pots", json!({})).await;
        let held = self.usdc_balance(&self.env.arena).await;
        assert_eq!(
            held,
            total.parse::<u128>().unwrap(),
            "{step}: arena USDC balance != total_pots"
        );
    }

    async fn storage_usage(&self, account: &AccountId) -> u64 {
        Account(account.clone())
            .view()
            .fetch_from(&self.env.net)
            .await
            .unwrap()
            .data
            .storage_usage
    }

    /// Faucet, register with the vault, and deposit into `pool`.
    async fn fund_player(&self, who: &AccountId, pool: &str, deposit: u128) {
        let _ = self
            .ok(
                &self.usdc,
                who,
                "faucet",
                json!({}),
                NearToken::from_millinear(10),
            )
            .await;
        let _ = self
            .ok(
                &self.vault,
                who,
                "storage_deposit",
                json!({}),
                NearToken::from_millinear(10),
            )
            .await;
        let res = self
            .ok(
                &self.usdc,
                who,
                "ft_transfer_call",
                json!({ "receiver_id": self.vault, "amount": deposit.to_string(), "msg": format!(r#"{{"pool":"{pool}"}}"#) }),
                yocto(1),
            )
            .await;
        assert!(
            res.logs().iter().any(|l| l.contains("vault_deposited")),
            "{res:?}"
        );
    }

    async fn pick(&self, backer: &AccountId, fighter: &AccountId) -> ExecutionFinalResult {
        self.call(
            &self.env.arena,
            backer,
            "pick",
            json!({ "fighter": fighter }),
            yocto(0),
        )
        .await
    }
}

async fn deploy(env: &Env, account: &AccountId, krate: &str, args: Value) {
    env.sandbox
        .create_account(account.as_str().parse().unwrap())
        .initial_balance(NearToken::from_near(20))
        .send()
        .await
        .expect("account created");
    Contract::deploy(account.clone())
        .use_code(build(krate))
        .with_init_call("new", args)
        .unwrap()
        .with_signer(env.signer.clone())
        .send_to(&env.net)
        .await
        .unwrap()
        .assert_success();
}

/// Arena linked to a real vault (demo mode) and USDC; season 1 closed and season 2 running with demo durations:
/// 10 min season, 5 min pick window, 1 min dispute window, 1 min close delay, 1 min claim period.
async fn economy() -> Economy {
    let env = Env::new().await;
    let usdc: AccountId = "usdc.sandbox".parse().unwrap();
    let vault: AccountId = "realvault.sandbox".parse().unwrap();
    let owner = env.owner.clone();
    deploy(&env, &usdc, "mock-usdc", json!({ "owner_id": owner })).await;
    deploy(
        &env,
        &vault,
        "vault",
        json!({ "owner_id": owner, "token_id": usdc, "arena_id": env.arena, "treasury_id": owner, "demo_mode": true }),
    )
    .await;
    let e = Economy {
        usdc: usdc.clone(),
        vault: vault.clone(),
        backer: "backer.sandbox".parse().unwrap(),
        backer2: "backer2.sandbox".parse().unwrap(),
        env,
    };
    for account in [&e.backer, &e.backer2] {
        e.env
            .sandbox
            .create_account(account.as_str().parse().unwrap())
            .initial_balance(NearToken::from_near(20))
            .send()
            .await
            .unwrap();
    }
    for account in [&vault, &e.env.arena, &owner] {
        let _ = e
            .ok(
                &usdc,
                &owner,
                "storage_deposit",
                json!({ "account_id": account }),
                NearToken::from_millinear(10),
            )
            .await;
    }
    let _ = e
        .ok(
            &usdc,
            &owner,
            "add_minter",
            json!({ "account_id": vault }),
            yocto(0),
        )
        .await;
    let _ = e
        .ok(
            &vault,
            &owner,
            "grant_role",
            json!({ "role": "Operator", "account_id": owner }),
            yocto(0),
        )
        .await;
    let arena = e.env.arena.clone();
    let _ = e
        .ok(
            &arena,
            &owner,
            "set_vault_id",
            json!({ "vault_id": vault }),
            yocto(0),
        )
        .await;
    let _ = e
        .ok(
            &arena,
            &owner,
            "set_token_id",
            json!({ "token_id": usdc }),
            yocto(0),
        )
        .await;
    let keeper = e.env.keeper.clone();
    let _ = e
        .ok(
            &arena,
            &owner,
            "grant_role",
            json!({ "role": "Keeper", "account_id": keeper }),
            yocto(0),
        )
        .await;

    let ops = e.env.operator.clone();
    let _ = e
        .ok(&arena, &ops, "end_season_now", json!({}), yocto(0))
        .await;
    let _ = e
        .ok(&arena, &ops, "close_season", json!({}), yocto(0))
        .await;
    let min = 60_000u64;
    let _ = e
        .ok(
            &arena,
            &ops,
            "set_durations",
            json!({ "season_duration_ms": 10 * min, "pick_window_ms": 5 * min, "dispute_window_ms": min, "close_delay_ms": min, "claim_period_ms": min }),
            yocto(0),
        )
        .await;
    let _ = e
        .ok(
            &arena,
            &ops,
            "start_season",
            json!({ "asset_ids": [1, 2, 3] }),
            yocto(0),
        )
        .await;
    e.assert_pots_held("setup").await;
    e
}

async fn fast_forward_past(e: &Economy, ms: u64) {
    while e.env.now_ms().await <= ms {
        e.env.sandbox.fast_forward(300).await.unwrap();
    }
}

#[tokio::test]
async fn picks_against_the_real_vault() {
    let e = economy().await;
    let fighter = e.env.fighter.clone();
    e.fund_player(&fighter, "Fighter", 10 * USDC).await;
    e.fund_player(&e.backer, "Backer", 100 * USDC).await;

    // Eligible Backer.
    let before = e.storage_usage(&e.env.arena).await;
    let res = e.pick(&e.backer, &fighter).await;
    let picked = event(&res, "picked").unwrap_or_else(|| panic!("{res:?}"));
    assert_eq!(picked["data"]["backer_count"], 1);
    let after = e.storage_usage(&e.env.arena).await;
    let picked_fighter: Option<String> = e
        .env
        .view("pick_of", json!({ "season": 2, "backer": e.backer }))
        .await;
    assert_eq!(picked_fighter.as_deref(), Some(fighter.as_str()));

    // Backer under the minimum (registered, never deposited).
    let _ = e
        .ok(
            &e.usdc,
            &e.backer2,
            "faucet",
            json!({}),
            NearToken::from_millinear(10),
        )
        .await;
    let res = e.pick(&e.backer2, &fighter).await;
    assert_eq!(
        event(&res, "pick_rejected").unwrap()["data"]["reason"],
        "not_eligible_backer"
    );
    // Picked account is not a Fighter (a Backer).
    let e2 = e.backer2.clone();
    let res = e
        .ok(
            &e.usdc,
            &e2,
            "ft_transfer_call",
            json!({ "receiver_id": e.vault, "amount": (100 * USDC).to_string(), "msg": r#"{"pool":"Backer"}"# }),
            yocto(1),
        )
        .await;
    assert!(
        res.logs().iter().any(|l| l.contains("not_registered")),
        "backer2 has no vault registration yet"
    );
    let _ = e
        .ok(
            &e.vault,
            &e2,
            "storage_deposit",
            json!({}),
            NearToken::from_millinear(10),
        )
        .await;
    let _ = e
        .ok(
            &e.usdc,
            &e2,
            "ft_transfer_call",
            json!({ "receiver_id": e.vault, "amount": (100 * USDC).to_string(), "msg": r#"{"pool":"Backer"}"# }),
            yocto(1),
        )
        .await;
    let res = e.pick(&e2, &e.backer).await;
    assert_eq!(
        event(&res, "pick_rejected").unwrap()["data"]["reason"],
        "not_a_fighter"
    );
    // A second pick by the first Backer fails.
    assert!(!is_ok(&e.pick(&e.backer, &fighter).await));
    let count: u32 = e
        .env
        .view("backer_count", json!({ "season": 2, "fighter": fighter }))
        .await;
    assert_eq!(count, 1);
    println!("STORAGE pick={} bytes", after - before);
}

#[tokio::test]
async fn full_season_with_claims_and_rollover() {
    let e = economy().await;
    let (arena, owner) = (e.env.arena.clone(), e.env.owner.clone());
    let (fighter, keeper, guardian) = (
        e.env.fighter.clone(),
        e.env.keeper.clone(),
        e.env.guardian.clone(),
    );

    // Deposits and a pick.
    e.fund_player(&fighter, "Fighter", 500 * USDC).await;
    e.fund_player(&e.backer, "Backer", 500 * USDC).await;
    let pick = e.pick(&e.backer, &fighter).await;
    assert!(event(&pick, "picked").is_some(), "{pick:?}");
    e.assert_pots_held("deposits").await;

    // A duel that scores.
    let start = e.env.start_duel([3; 32]).await;
    let id = event(&start, "duel_created").unwrap_or_else(|| panic!("{start:?}"))["data"]
        ["duel_id"]
        .as_u64()
        .unwrap();
    let start_ms = e.env.duel(id).await["start_ms"].as_u64().unwrap();
    e.env.wait_until(start_ms).await;
    assert!(is_ok(&e.env.open(id, &fighter, "Long", 1).await));
    e.env.set_price(P + P * 30 / 1_000_000).await;
    e.env.wait_until(start_ms + 4_000).await;
    assert!(is_ok(&e.env.close(id, &fighter, "Long", 1).await));
    e.env.wait_until(start_ms + 40_000).await;
    let _ = e
        .env
        .ok(&keeper, "settle_duel", json!({ "duel_id": id }))
        .await;
    let reveal = e.env.reveal(id, [3; 32]).await;
    assert!(event(&reveal, "result_recorded").is_some(), "{reveal:?}");

    // Unexpected pot transfers are refunded: a non-vault sender, the vault with another message, another token.
    let res = e
        .ok(
            &e.usdc,
            &fighter,
            "ft_transfer_call",
            json!({ "receiver_id": arena, "amount": "5000000", "msg": "fund_pot" }),
            yocto(1),
        )
        .await;
    assert!(res.logs().iter().any(|l| l.contains("not_vault")));
    let vault = e.vault.clone();
    let res = e
        .ok(
            &e.usdc,
            &vault,
            "ft_transfer_call",
            json!({ "receiver_id": arena, "amount": "5000000", "msg": "tip" }),
            yocto(1),
        )
        .await;
    assert!(res.logs().iter().any(|l| l.contains("bad_msg")));
    let fake: AccountId = "fake-usdc.sandbox".parse().unwrap();
    deploy(&e.env, &fake, "mock-usdc", json!({ "owner_id": owner })).await;
    let _ = e
        .ok(
            &fake,
            &owner,
            "storage_deposit",
            json!({ "account_id": arena }),
            NearToken::from_millinear(10),
        )
        .await;
    let _ = e
        .ok(
            &fake,
            &fighter,
            "faucet",
            json!({}),
            NearToken::from_millinear(10),
        )
        .await;
    let res = e
        .ok(
            &fake,
            &fighter,
            "ft_transfer_call",
            json!({ "receiver_id": arena, "amount": "5000000", "msg": "fund_pot" }),
            yocto(1),
        )
        .await;
    assert!(res.logs().iter().any(|l| l.contains("wrong_token")));
    let fake_balance: String = e
        .view_on(&fake, "ft_balance_of", json!({ "account_id": fighter }))
        .await;
    assert_eq!(fake_balance, (1_000 * USDC).to_string());
    e.assert_pots_held("refunds").await;

    // The vault funds the pot: a direct `fund_pot` transfer from the vault account, then a real harvest.
    let direct = e
        .ok(
            &e.usdc,
            &vault,
            "ft_transfer_call",
            json!({ "receiver_id": arena, "amount": "1000000", "msg": "fund_pot" }),
            yocto(1),
        )
        .await;
    assert!(direct.logs().iter().any(|l| l.contains("pot_funded")));
    let _ = e
        .ok(
            &vault,
            &owner,
            "set_time_multiplier",
            json!({ "multiplier": 1_000_000 }),
            yocto(0),
        )
        .await;
    e.env.sandbox.fast_forward(20).await.unwrap();
    let harvest = e.ok(&vault, &owner, "harvest", json!({}), yocto(0)).await;
    assert!(
        harvest.logs().iter().any(|l| l.contains("pot_funded")),
        "{harvest:?}"
    );
    e.assert_pots_held("harvest").await;
    let pot = amount(&e.env.view::<Value>("pot_of", json!({ "season": 2 })).await);
    assert!(pot > USDC);

    // Close the season and post single-entry results (a one-leaf root is the leaf itself).
    let ops = e.env.operator.clone();
    let _ = e
        .ok(&arena, &ops, "end_season_now", json!({}), yocto(0))
        .await;
    let _ = e
        .ok(&arena, &ops, "close_season", json!({}), yocto(0))
        .await;
    let prize = pot * 7_000 / 10_000;
    let bonus = pot * 2_500 / 10_000;
    let prize_root: Value = e
        .env
        .view(
            "leaf_of",
            json!({ "account_id": fighter, "amount": prize.to_string() }),
        )
        .await;
    let bonus_root: Value = e
        .env
        .view(
            "leaf_of",
            json!({ "account_id": e.backer, "amount": bonus.to_string() }),
        )
        .await;
    let post = e
        .ok(
            &arena,
            &keeper,
            "post_results",
            json!({ "season": 2, "prize_root": prize_root, "bonus_root": bonus_root, "prize_total": prize.to_string(), "bonus_total": bonus.to_string() }),
            yocto(0),
        )
        .await;
    let claim_opens = event(&post, "results_posted").unwrap()["data"]["claim_opens_ms"]
        .as_u64()
        .unwrap();
    let early = e
        .call(
            &arena,
            &fighter,
            "claim_prize",
            json!({ "season": 2, "amount": prize.to_string(), "proof": [] }),
            yocto(0),
        )
        .await;
    assert!(!is_ok(&early), "claims wait for the dispute window");
    fast_forward_past(&e, claim_opens).await;
    let season: Value = e.env.view("get_season", json!({ "season": 2 })).await;
    assert_eq!(season["phase"], "Finalized");

    // Claims pause.
    let _ = e
        .ok(&arena, &guardian, "pause_claims", json!({}), yocto(0))
        .await;
    let paused = e
        .call(
            &arena,
            &fighter,
            "claim_prize",
            json!({ "season": 2, "amount": prize.to_string(), "proof": [] }),
            yocto(0),
        )
        .await;
    assert!(!is_ok(&paused));
    let _ = e
        .ok(&arena, &guardian, "unpause_claims", json!({}), yocto(0))
        .await;

    // The Fighter claims the prize.
    let before = e.usdc_balance(&fighter).await;
    let storage_before = e.storage_usage(&arena).await;
    let claim = e
        .ok(
            &arena,
            &fighter,
            "claim_prize",
            json!({ "season": 2, "amount": prize.to_string(), "proof": [] }),
            yocto(0),
        )
        .await;
    assert!(event(&claim, "prize_claimed").is_some());
    let storage_after = e.storage_usage(&arena).await;
    assert_eq!(e.usdc_balance(&fighter).await, before + prize);
    let claimed: bool = e
        .env
        .view(
            "is_claimed",
            json!({ "season": 2, "kind": "Prize", "account_id": fighter }),
        )
        .await;
    assert!(claimed);
    assert!(!is_ok(
        &e.call(
            &arena,
            &fighter,
            "claim_prize",
            json!({ "season": 2, "amount": prize.to_string(), "proof": [] }),
            yocto(0)
        )
        .await
    ));
    e.assert_pots_held("prize claim").await;

    // The Backer leaves the token: the bonus transfer fails and is reversed; after registering again it works.
    let backer = e.backer.clone();
    let _ = e
        .ok(
            &e.usdc,
            &backer,
            "storage_unregister",
            json!({ "force": true }),
            yocto(1),
        )
        .await;
    let failed = e
        .ok(
            &arena,
            &backer,
            "claim_bonus",
            json!({ "season": 2, "amount": bonus.to_string(), "proof": [] }),
            yocto(0),
        )
        .await;
    assert!(event(&failed, "claim_failed").is_some(), "{failed:?}");
    let claimed: bool = e
        .env
        .view(
            "is_claimed",
            json!({ "season": 2, "kind": "Bonus", "account_id": backer }),
        )
        .await;
    assert!(!claimed);
    e.assert_pots_held("bonus reverted").await;
    let _ = e
        .ok(
            &e.usdc,
            &backer,
            "storage_deposit",
            json!({}),
            NearToken::from_millinear(10),
        )
        .await;
    let ok = e
        .ok(
            &arena,
            &backer,
            "claim_bonus",
            json!({ "season": 2, "amount": bonus.to_string(), "proof": [] }),
            yocto(0),
        )
        .await;
    assert!(event(&ok, "bonus_claimed").is_some() && event(&ok, "claim_failed").is_none());
    assert_eq!(e.usdc_balance(&backer).await, bonus);
    e.assert_pots_held("bonus claim").await;

    // After the claim period the remainder rolls over to the next season.
    let left = amount(&e.env.view::<Value>("pot_of", json!({ "season": 2 })).await);
    assert_eq!(left, pot - prize - bonus);
    fast_forward_past(&e, claim_opens + 60_000).await;
    let rollover = e
        .ok(
            &arena,
            &keeper,
            "rollover_unclaimed",
            json!({ "season": 2 }),
            yocto(0),
        )
        .await;
    let rolled = event(&rollover, "season_rolled_over").unwrap();
    assert_eq!(rolled["data"]["to_season"], 3);
    assert_eq!(
        amount(&e.env.view::<Value>("pot_of", json!({ "season": 3 })).await),
        left
    );
    assert_eq!(
        amount(&e.env.view::<Value>("pot_of", json!({ "season": 2 })).await),
        0
    );
    e.assert_pots_held("rollover").await;

    println!(
        "GAS pick={:.2} Tgas, fund_pot ft_on_transfer (vault ft_transfer_call)={:.2} Tgas, post_results={:.2} Tgas, claim_prize={:.2} Tgas, rollover_unclaimed={:.2} Tgas",
        tgas(&pick),
        tgas(&direct),
        tgas(&post),
        tgas(&claim),
        tgas(&rollover)
    );
    println!(
        "STORAGE claim={} bytes",
        storage_after.saturating_sub(storage_before)
    );
}
