//! Sandbox harness: builds `arena` and `mock-vault`, starts a local node, creates the accounts, deploys and
//! configures both contracts, and runs a background price feed for BTC.

#![allow(dead_code)]

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use ed25519_dalek::{Signer as _, SigningKey};
use near_api::types::transaction::result::ExecutionFinalResult;
use near_api::{AccountId, Chain, Contract, NearGas, NearToken, NetworkConfig, Signer};
use near_sandbox::{GenesisAccount, Sandbox};
use near_sdk::json_types::Base64VecU8;
use near_sdk::serde::de::DeserializeOwned;
use near_sdk::{CurveType, PublicKey};
use serde_json::{json, Value};
use tokio::task::JoinHandle;

pub const BTC: u32 = 2;
pub const P: i64 = 100_000_000;
pub const EXPO: i32 = -8;

static WASMS: OnceLock<(Vec<u8>, Vec<u8>)> = OnceLock::new();

fn build(krate: &str) -> Vec<u8> {
    let manifest = format!("{}/../{krate}/Cargo.toml", env!("CARGO_MANIFEST_DIR"));
    let opts = cargo_near_build::BuildOpts::builder()
        .manifest_path(manifest)
        .no_abi(true)
        .build();
    let path = cargo_near_build::build_with_cli(opts).expect("contract builds");
    std::fs::read(path).expect("wasm readable")
}

/// `(arena, mock-vault)` wasm, built once per test binary.
pub fn wasms() -> &'static (Vec<u8>, Vec<u8>) {
    WASMS.get_or_init(|| (build("arena"), build("mock-vault")))
}

pub fn b64(bytes: &[u8]) -> Value {
    serde_json::to_value(Base64VecU8(bytes.to_vec())).unwrap()
}

pub fn from_b64(v: &Value) -> Vec<u8> {
    serde_json::from_value::<Base64VecU8>(v.clone()).unwrap().0
}

pub fn events(res: &ExecutionFinalResult) -> Vec<Value> {
    res.logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .map(|j| serde_json::from_str(j).unwrap())
        .collect()
}

pub fn event(res: &ExecutionFinalResult, name: &str) -> Option<Value> {
    events(res).into_iter().find(|e| e["event"] == name)
}

pub fn is_ok(res: &ExecutionFinalResult) -> bool {
    res.clone().into_result().is_ok()
}

pub fn tgas(res: &ExecutionFinalResult) -> f64 {
    res.total_gas_burnt.as_gas() as f64 / 1e12
}

pub struct Env {
    pub sandbox: Sandbox,
    pub net: NetworkConfig,
    pub signer: Arc<Signer>,
    pub arena: AccountId,
    pub vault: AccountId,
    pub owner: AccountId,
    pub guardian: AccountId,
    pub operator: AccountId,
    pub pusher: AccountId,
    pub keeper: AccountId,
    pub fighter: AccountId,
    pub bot: AccountId,
    pub bot_service: SigningKey,
    pub price: Arc<AtomicI64>,
    pub feed_on: Arc<AtomicBool>,
    feed: Option<JoinHandle<()>>,
}

impl Drop for Env {
    fn drop(&mut self) {
        if let Some(feed) = self.feed.take() {
            feed.abort();
        }
    }
}

/// Latest block time in ms.
pub async fn block_ms(net: &NetworkConfig) -> u64 {
    let block = Chain::block().fetch_from(net).await.expect("block");
    block.header.timestamp / 1_000_000
}

impl Env {
    /// A configured arena: roles, assets 1–3, bot level 1, countdown 1 s, season 1 running, BTC feed on.
    pub async fn new() -> Env {
        let (arena_wasm, vault_wasm) = wasms().clone();
        let sandbox = Sandbox::start_sandbox().await.expect("sandbox starts");
        let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse().unwrap());
        let genesis = GenesisAccount::default();
        let signer = Signer::from_secret_key(genesis.private_key.parse().unwrap()).unwrap();

        let id = |name: &str| -> AccountId { format!("{name}.sandbox").parse().unwrap() };
        let mut env = Env {
            arena: id("arena"),
            vault: id("vault"),
            owner: id("owner"),
            guardian: id("guardian"),
            operator: id("ops"),
            pusher: id("pusher"),
            keeper: id("keeper"),
            fighter: id("fighter"),
            bot: id("rookie"),
            bot_service: SigningKey::from_bytes(&[7u8; 32]),
            price: Arc::new(AtomicI64::new(P)),
            feed_on: Arc::new(AtomicBool::new(true)),
            feed: None,
            sandbox,
            net,
            signer,
        };
        for account in [
            &env.arena,
            &env.vault,
            &env.owner,
            &env.guardian,
            &env.operator,
            &env.pusher,
            &env.keeper,
            &env.fighter,
            &env.bot,
        ] {
            env.sandbox
                .create_account(account.as_str().parse().unwrap())
                .initial_balance(NearToken::from_near(100))
                .send()
                .await
                .expect("account created");
        }

        Contract::deploy(env.vault.clone())
            .use_code(vault_wasm)
            .with_init_call("new", json!({ "default_answer": true }))
            .unwrap()
            .with_signer(env.signer.clone())
            .send_to(&env.net)
            .await
            .unwrap()
            .assert_success();

        let pk = PublicKey::from_parts(
            CurveType::ED25519,
            env.bot_service.verifying_key().to_bytes().to_vec(),
        )
        .unwrap();
        Contract::deploy(env.arena.clone())
            .use_code(arena_wasm)
            .with_init_call(
                "new",
                json!({
                    "owner_id": env.owner,
                    "vault_id": env.vault,
                    "bot_service_pk": String::from(&pk),
                    "ring_size": null,
                }),
            )
            .unwrap()
            .with_signer(env.signer.clone())
            .send_to(&env.net)
            .await
            .unwrap()
            .assert_success();

        let owner = env.owner.clone();
        for (role, account) in [
            ("Guardian", &env.guardian),
            ("Operator", &env.operator),
            ("Pusher", &env.pusher),
        ] {
            let _ = env
                .ok(
                    &owner,
                    "grant_role",
                    json!({ "role": role, "account_id": account }),
                )
                .await;
        }
        for (n, symbol) in [(1u8, "GOOGL"), (2, "BTC"), (3, "XAU")] {
            let _ = env
                .ok(
                    &owner,
                    "add_asset",
                    json!({ "feed_id": format!("{n:064x}"), "symbol": symbol }),
                )
                .await;
        }
        let bot = env.bot.clone();
        let _ = env
            .ok(
                &owner,
                "set_bot",
                json!({ "level": 1, "account_id": bot, "active": true }),
            )
            .await;
        let _ = env
            .ok(&owner, "set_params", json!({ "countdown_ms": 1_000 }))
            .await;
        let operator = env.operator.clone();
        let _ = env
            .ok(&operator, "start_season", json!({ "asset_ids": [1, 2, 3] }))
            .await;

        env.feed = Some(env.spawn_feed());
        env.wait_fresh().await;
        env
    }

    fn spawn_feed(&self) -> JoinHandle<()> {
        let net = self.net.clone();
        let signer = self.signer.clone();
        let arena = self.arena.clone();
        let pusher = self.pusher.clone();
        let price = self.price.clone();
        let on = self.feed_on.clone();
        tokio::spawn(async move {
            loop {
                if on.load(Ordering::SeqCst) {
                    let now = block_ms(&net).await;
                    let _ = Contract(arena.clone())
                        .call_function(
                            "push_ticks",
                            json!({ "ticks": [{
                                "asset_id": BTC,
                                "price": price.load(Ordering::SeqCst),
                                "expo": EXPO,
                                "publish_ms": now,
                            }]}),
                        )
                        .transaction()
                        .with_signer(pusher.clone(), signer.clone())
                        .send_to(&net)
                        .await;
                }
                tokio::time::sleep(Duration::from_millis(400)).await;
            }
        })
    }

    /// Waits until the BTC price is fresh on chain.
    pub async fn wait_fresh(&self) {
        for _ in 0..100 {
            if !self
                .view::<bool>("is_stale", json!({ "asset_id": BTC }))
                .await
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        panic!("price never became fresh");
    }

    /// Waits until a new BTC tick (index above `after`) is on chain.
    pub async fn wait_tick_after(&self, after: u64) -> u64 {
        for _ in 0..100 {
            let latest: u64 = self
                .view("latest_tick_index", json!({ "asset_id": BTC }))
                .await;
            if latest > after {
                return latest;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        panic!("no new tick");
    }

    /// Sets the feed price and waits until a tick with it is on chain.
    pub async fn set_price(&self, price: i64) {
        self.price.store(price, Ordering::SeqCst);
        let before: u64 = self
            .view("latest_tick_index", json!({ "asset_id": BTC }))
            .await;
        // The tick pushed right after `before` may have been signed with the old price.
        let next = self.wait_tick_after(before).await;
        self.wait_tick_after(next).await;
    }

    pub async fn now_ms(&self) -> u64 {
        block_ms(&self.net).await
    }

    /// Waits until the chain clock reaches `ms`.
    pub async fn wait_until(&self, ms: u64) {
        while self.now_ms().await < ms {
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }

    pub async fn call_on(
        &self,
        contract: &AccountId,
        who: &AccountId,
        method: &str,
        args: Value,
        gas: NearGas,
    ) -> ExecutionFinalResult {
        Contract(contract.clone())
            .call_function(method, args)
            .transaction()
            .gas(gas)
            .with_signer(who.clone(), self.signer.clone())
            .send_to(&self.net)
            .await
            .expect("transaction sent")
            .into_full()
            .expect("transaction executed")
    }

    pub async fn call(&self, who: &AccountId, method: &str, args: Value) -> ExecutionFinalResult {
        self.call_on(&self.arena, who, method, args, NearGas::from_tgas(100))
            .await
    }

    /// Calls and asserts success.
    pub async fn ok(&self, who: &AccountId, method: &str, args: Value) -> ExecutionFinalResult {
        let res = self.call(who, method, args.clone()).await;
        assert!(is_ok(&res), "{method}({args}) failed: {res:?}");
        res
    }

    pub async fn view<T: DeserializeOwned + Send + Sync>(&self, method: &str, args: Value) -> T {
        Contract(self.arena.clone())
            .call_function(method, args)
            .read_only()
            .fetch_from(&self.net)
            .await
            .unwrap_or_else(|e| panic!("view {method} failed: {e:?}"))
            .data
    }

    pub async fn vault_call(&self, method: &str, args: Value) {
        let res = self
            .call_on(
                &self.vault,
                &self.owner,
                method,
                args,
                NearGas::from_tgas(30),
            )
            .await;
        assert!(is_ok(&res));
    }

    /// A ticket for the Fighter at level 1 on BTC with `seed`, signed by the bot service via `ticket_message`.
    pub async fn ticket(&self, seed: [u8; 32]) -> (Value, Value) {
        let nonce: u64 = self
            .view("nonce_of", json!({ "fighter": self.fighter }))
            .await;
        let seed_hash: Value = self
            .view(
                "compute_seed_hash",
                json!({ "seed": b64(&seed), "fighter": self.fighter, "nonce": nonce }),
            )
            .await;
        let ticket = json!({
            "fighter": self.fighter,
            "asset_id": BTC,
            "bot_level": 1,
            "seed_hash": seed_hash,
            "nonce": nonce,
            "deadline_ms": self.now_ms().await + 50_000,
        });
        let message: Value = self
            .view("ticket_message", json!({ "ticket": ticket }))
            .await;
        let signature = self.bot_service.sign(&from_b64(&message)).to_bytes();
        (ticket, b64(&signature))
    }

    pub async fn start_duel_with_gas(&self, seed: [u8; 32], gas: NearGas) -> ExecutionFinalResult {
        let (ticket, signature) = self.ticket(seed).await;
        self.call_on(
            &self.arena,
            &self.fighter,
            "start_duel",
            json!({ "ticket": ticket, "signature": signature }),
            gas,
        )
        .await
    }

    pub async fn start_duel(&self, seed: [u8; 32]) -> ExecutionFinalResult {
        self.start_duel_with_gas(seed, NearGas::from_tgas(100))
            .await
    }

    pub async fn commit(&self, duel_id: u64, player: &AccountId, dir: &str, salt: u8) -> Value {
        self.view(
            "compute_commit",
            json!({ "dir": dir, "salt": b64(&[salt; 32]), "duel_id": duel_id, "player": player }),
        )
        .await
    }

    pub async fn open(
        &self,
        duel_id: u64,
        player: &AccountId,
        dir: &str,
        salt: u8,
    ) -> ExecutionFinalResult {
        let commit = self.commit(duel_id, player, dir, salt).await;
        self.call(
            player,
            "open_position",
            json!({ "duel_id": duel_id, "commit": commit }),
        )
        .await
    }

    pub async fn close(
        &self,
        duel_id: u64,
        player: &AccountId,
        dir: &str,
        salt: u8,
    ) -> ExecutionFinalResult {
        self.call(
            player,
            "close_position",
            json!({ "duel_id": duel_id, "dir": dir, "salt": b64(&[salt; 32]) }),
        )
        .await
    }

    pub async fn duel(&self, duel_id: u64) -> Value {
        self.view("get_duel", json!({ "duel_id": duel_id })).await
    }

    pub async fn reveal(&self, duel_id: u64, seed: [u8; 32]) -> ExecutionFinalResult {
        self.call(
            &self.keeper.clone(),
            "reveal_bot_seed",
            json!({ "duel_id": duel_id, "seed": b64(&seed), "decisions_hash": null }),
        )
        .await
    }
}
