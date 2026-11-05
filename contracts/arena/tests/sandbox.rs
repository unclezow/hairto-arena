//! Integration tests on a local sandbox node: the real `start_duel` -> `vault.can_play` -> `on_start_duel` round
//! trip, a full duel with block-time timing, failure paths, KO, outage void, late reveal and prune.
//!
//! Run with `cargo test -p arena --test sandbox -- --nocapture` to see the gas report.

mod common;

use common::*;
use near_api::NearGas;
use serde_json::{json, Value};

fn moved(ppm: i64) -> i64 {
    P + P * ppm / 1_000_000
}

async fn duel_id_of(res: &near_api::types::transaction::result::ExecutionFinalResult) -> u64 {
    let created = event(res, "duel_created").unwrap_or_else(|| panic!("no duel_created: {res:?}"));
    created["data"]["duel_id"].as_u64().unwrap()
}

async fn wait_open_hold(env: &Env, duel_id: u64, side: &str) {
    let pos: Value = env
        .view("get_position", json!({ "duel_id": duel_id, "side": side }))
        .await;
    env.wait_until(pos["open_ms"].as_u64().unwrap() + 3_000)
        .await;
}

#[tokio::test]
async fn full_duel() {
    let env = Env::new().await;
    let fighter = env.fighter.clone();
    let bot = env.bot.clone();
    let keeper = env.keeper.clone();
    let seed = [11u8; 32];

    let start = env.start_duel(seed).await;
    assert!(is_ok(&start), "{start:?}");
    assert_eq!(start.clone().json::<Option<u64>>().unwrap(), Some(1));
    let id = duel_id_of(&start).await;
    let duel = env.duel(id).await;
    let start_ms = duel["start_ms"].as_u64().unwrap();
    assert_eq!(duel["status"], "Active");

    env.wait_until(start_ms).await;
    let open_f = env.open(id, &fighter, "Long", 1).await;
    assert!(is_ok(&open_f), "{open_f:?}");
    let e = event(&open_f, "position_opened").unwrap();
    assert!(e["data"].get("dir").is_none());
    let open_b = env.open(id, &bot, "Short", 2).await;
    assert!(is_ok(&open_b), "{open_b:?}");

    // +30 ppm on BTC (×400) = 120 HP per hit.
    env.set_price(moved(30)).await;
    wait_open_hold(&env, id, "Fighter").await;
    let close_f = env.close(id, &fighter, "Long", 1).await;
    assert!(is_ok(&close_f), "{close_f:?}");
    let e = event(&close_f, "position_closed").unwrap();
    assert_eq!(e["data"]["net_pnl_ppm"], 30);
    assert_eq!(e["data"]["opponent_delta"], -120);
    wait_open_hold(&env, id, "Bot").await;
    let close_b = env.close(id, &bot, "Short", 2).await;
    assert!(is_ok(&close_b), "{close_b:?}");
    assert_eq!(
        event(&close_b, "position_closed").unwrap()["data"]["net_pnl_ppm"],
        -30
    );

    let duel = env.duel(id).await;
    // The bot's losing Short hurts the bot itself: 1000 - 120 (Fighter's hit) - 120 (own loss).
    assert_eq!(
        (duel["hp_fighter"].as_u64(), duel["hp_bot"].as_u64()),
        (Some(1_000), Some(760))
    );
    let end = duel["effective_end_ms"].as_u64().unwrap();
    env.wait_until(end + 10_000).await;

    let settle = env
        .ok(&keeper, "settle_duel", json!({ "duel_id": id }))
        .await;
    let e = event(&settle, "duel_finished").unwrap();
    assert_eq!(e["data"]["winner"], fighter.as_str());
    assert_eq!(e["data"]["ko"], false);
    assert!(env
        .view::<Option<Value>>("active_duel_of", json!({ "fighter": fighter }))
        .await
        .is_none());

    let reveal = env.reveal(id, seed).await;
    assert!(is_ok(&reveal), "{reveal:?}");
    let r = event(&reveal, "result_recorded").unwrap();
    // Rookie win by 240 HP: 5 + 5 × 240 / 1000 = 6.
    assert_eq!(r["data"]["points"], 6);
    assert!(env
        .view::<Option<Value>>("get_duel", json!({ "duel_id": id }))
        .await
        .is_none());
    let score: Value = env
        .view("score_of", json!({ "season": 1, "fighter": fighter }))
        .await;
    assert_eq!(
        (score["points"].as_u64(), score["duels"].as_u64()),
        (Some(6), Some(1))
    );

    // Every Fighter play call above attached zero deposit. Gas report for design.md:
    println!(
        "GAS start_duel={:.2} Tgas, open_position={:.2} Tgas, close_position={:.2} Tgas, settle_duel={:.2} Tgas, reveal_bot_seed={:.2} Tgas",
        tgas(&start),
        tgas(&open_f),
        tgas(&close_f),
        tgas(&settle),
        tgas(&reveal)
    );
}

#[tokio::test]
async fn vault_failures_and_retry() {
    let env = Env::new().await;
    let fighter = env.fighter.clone();
    let active = || async {
        env.view::<Option<Value>>("active_duel_of", json!({ "fighter": env.fighter }))
            .await
    };

    // Vault says no.
    env.vault_call("set_default", json!({ "answer": false }))
        .await;
    let res = env.start_duel([1; 32]).await;
    assert!(is_ok(&res), "{res:?}");
    assert_eq!(res.clone().json::<Option<u64>>().unwrap(), None);
    assert_eq!(
        event(&res, "duel_rejected").unwrap()["data"]["reason"],
        "not_eligible"
    );
    assert!(active().await.is_none());
    assert_eq!(
        env.view::<u64>("nonce_of", json!({ "fighter": fighter }))
            .await,
        1
    );

    // Vault panics.
    env.vault_call("set_panic_mode", json!({ "enabled": true }))
        .await;
    let res = env.start_duel([2; 32]).await;
    assert!(is_ok(&res), "{res:?}");
    assert!(
        !res.receipt_failures().is_empty(),
        "the vault receipt failed"
    );
    assert_eq!(
        event(&res, "duel_rejected").unwrap()["data"]["reason"],
        "vault_error"
    );
    assert!(active().await.is_none());

    // Too little gas fails before anything changes.
    env.vault_call("set_panic_mode", json!({ "enabled": false }))
        .await;
    env.vault_call("set_default", json!({ "answer": true }))
        .await;
    let res = env
        .start_duel_with_gas([3; 32], NearGas::from_tgas(59))
        .await;
    assert!(!is_ok(&res));
    assert_eq!(
        env.view::<u64>("nonce_of", json!({ "fighter": fighter }))
            .await,
        2
    );

    // Retry with a new ticket at the 60 Tgas floor succeeds.
    let res = env
        .start_duel_with_gas([3; 32], NearGas::from_tgas(60))
        .await;
    assert!(is_ok(&res), "{res:?}");
    let id = duel_id_of(&res).await;
    assert_eq!(id, 1);
    println!(
        "GAS start_duel at 60 Tgas prepaid burnt {:.2} Tgas",
        tgas(&res)
    );

    // The callback is private and the contract cannot be initialized twice.
    let ticket = env.ticket([4; 32]).await.0;
    let res = env
        .call(&fighter, "on_start_duel", json!({ "ticket": ticket }))
        .await;
    assert!(!is_ok(&res));
    let res = env
        .call(
            &env.owner.clone(),
            "new",
            json!({ "owner_id": fighter, "vault_id": fighter, "bot_service_pk": "ed25519:11111111111111111111111111111111", "ring_size": null }),
        )
        .await;
    assert!(!is_ok(&res));
    let config: Value = env.view("get_config", json!({})).await;
    assert_eq!(config["owner_id"], env.owner.as_str());
}

#[tokio::test]
async fn ko_path() {
    let env = Env::new().await;
    let owner = env.owner.clone();
    let fighter = env.fighter.clone();
    let bot = env.bot.clone();
    let keeper = env.keeper.clone();

    // One HP per ppm so a single 0.2 % move is a KO.
    let added = env
        .ok(
            &owner,
            "add_damage_config",
            json!({ "config": { "PnlDifference": { "ppm_per_hp": 1, "paper_cost_ppm": 0 } } }),
        )
        .await;
    let config_id = added.json::<u32>().unwrap();
    let _ = env
        .ok(&owner, "activate_damage_config", json!({ "id": config_id }))
        .await;

    let start = env.start_duel([5; 32]).await;
    let id = duel_id_of(&start).await;
    let start_ms = env.duel(id).await["start_ms"].as_u64().unwrap();
    env.wait_until(start_ms).await;
    assert!(is_ok(&env.open(id, &fighter, "Long", 1).await));
    assert!(is_ok(&env.open(id, &bot, "Short", 2).await));

    env.wait_until(start_ms + 5_500).await;
    env.set_price(moved(2_000)).await;
    let close = env.close(id, &fighter, "Long", 1).await;
    assert!(is_ok(&close), "{close:?}");
    let e = event(&close, "position_closed").unwrap();
    assert_eq!(e["data"]["ko"], true);
    assert_eq!(e["data"]["hp_bot"], 0);
    let duel = env.duel(id).await;
    let ko_ms = duel["ko_ms"].as_u64().unwrap();
    assert_eq!(duel["effective_end_ms"].as_u64(), Some(ko_ms));

    // No new opens after the KO; the bot can still reveal in the grace window.
    assert!(!is_ok(&env.open(id, &fighter, "Long", 3).await));
    let close_b = env.close(id, &bot, "Short", 2).await;
    assert!(is_ok(&close_b), "{close_b:?}");

    env.wait_until(ko_ms + 10_000).await;
    let settle = env
        .ok(&keeper, "settle_duel", json!({ "duel_id": id }))
        .await;
    let e = event(&settle, "duel_finished").unwrap();
    assert_eq!(e["data"]["ko"], true);
    assert_eq!(e["data"]["winner"], fighter.as_str());
    assert!(
        ko_ms + 10_000 < start_ms + 40_000,
        "settled before the normal round end"
    );
}

#[tokio::test]
async fn outage_void() {
    let env = Env::new().await;
    let keeper = env.keeper.clone();
    let start = env.start_duel([6; 32]).await;
    let id = duel_id_of(&start).await;
    let start_ms = env.duel(id).await["start_ms"].as_u64().unwrap();
    env.wait_until(start_ms + 1_000).await;
    // Healthy feed: cannot void.
    assert!(!is_ok(
        &env.call(&keeper, "void_duel", json!({ "duel_id": id }))
            .await
    ));

    env.feed_on
        .store(false, std::sync::atomic::Ordering::SeqCst);
    let last: Value = env.view("latest_tick", json!({ "asset_id": BTC })).await;
    env.wait_until(last["publish_ms"].as_u64().unwrap() + 11_000)
        .await;
    let void = env.ok(&keeper, "void_duel", json!({ "duel_id": id })).await;
    assert!(event(&void, "duel_voided").is_some());
    assert_eq!(env.duel(id).await["status"], "Voided");

    let reveal = env.reveal(id, [6; 32]).await;
    assert!(is_ok(&reveal));
    assert!(
        event(&reveal, "result_recorded").is_none(),
        "voided duels never score"
    );
}

#[tokio::test]
async fn late_reveal_and_prune() {
    let env = Env::new().await;
    let keeper = env.keeper.clone();

    // Two idle duels in a row, both forfeited.
    let mut ids = vec![];
    for seed in [[8u8; 32], [9u8; 32]] {
        let start = env.start_duel(seed).await;
        let id = duel_id_of(&start).await;
        let end = env.duel(id).await["effective_end_ms"].as_u64().unwrap();
        env.wait_until(end + 10_000).await;
        let settle = env
            .ok(&keeper, "settle_duel", json!({ "duel_id": id }))
            .await;
        assert!(event(&settle, "duel_forfeited").is_some());
        ids.push(id);
    }
    let settled = env.duel(ids[1]).await["settled_ms"].as_u64().unwrap();
    assert!(!is_ok(
        &env.call(&keeper, "prune_duel", json!({ "duel_id": ids[1] }))
            .await
    ));

    // Skip past the 10-minute seed reveal timeout.
    while env.now_ms().await <= settled + 600_000 {
        env.sandbox.fast_forward(500).await.unwrap();
    }

    let reveal = env.reveal(ids[0], [8; 32]).await;
    assert!(is_ok(&reveal), "{reveal:?}");
    assert!(event(&reveal, "bot_seed_revealed").is_some());
    assert!(
        event(&reveal, "result_recorded").is_none(),
        "late reveal does not score"
    );

    let prune = env
        .ok(&keeper, "prune_duel", json!({ "duel_id": ids[1] }))
        .await;
    assert!(event(&prune, "duel_pruned").is_some());
    assert!(env
        .view::<Option<Value>>("get_duel", json!({ "duel_id": ids[1] }))
        .await
        .is_none());
    let score: Value = env
        .view("score_of", json!({ "season": 1, "fighter": env.fighter }))
        .await;
    assert_eq!(score["duels"], 0);
}
