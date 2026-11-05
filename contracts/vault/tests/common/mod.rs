//! Sandbox harness: real `mock-usdc`, the `vault` in demo mode, and `mock-arena` as the pot receiver. The vault,
//! arena and treasury are registered with USDC, the vault is a minter, and two Fighters and two Backers have
//! 1 000 USDC each from the faucet and are registered with the vault.

#![allow(dead_code)]

use std::sync::{Arc, OnceLock};

use near_api::types::transaction::result::ExecutionFinalResult;
use near_api::{AccountId, Contract, NearGas, NearToken, NetworkConfig, Signer};
use near_sandbox::{GenesisAccount, Sandbox};
use near_sdk::serde::de::DeserializeOwned;
use serde_json::{json, Value};

pub const ONE_USDC: u128 = 1_000_000;
pub const FIGHTER: &str = r#"{"pool":"Fighter"}"#;
pub const BACKER: &str = r#"{"pool":"Backer"}"#;

pub fn usd(n: u128) -> u128 {
    n * ONE_USDC
}

static WASMS: OnceLock<Vec<Vec<u8>>> = OnceLock::new();

fn build(krate: &str) -> Vec<u8> {
    let manifest = format!("{}/../{krate}/Cargo.toml", env!("CARGO_MANIFEST_DIR"));
    let opts = cargo_near_build::BuildOpts::builder()
        .manifest_path(manifest)
        .no_abi(true)
        .build();
    let path = cargo_near_build::build_with_cli(opts).expect("contract builds");
    std::fs::read(path).expect("wasm readable")
}

/// `[vault, mock-usdc, mock-arena]` wasm, built once per test binary.
pub fn wasms() -> &'static [Vec<u8>] {
    WASMS.get_or_init(|| vec![build("vault"), build("mock-usdc"), build("mock-arena")])
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

pub fn amount(v: &Value) -> u128 {
    v.as_str().unwrap().parse().unwrap()
}

pub fn yocto(n: u128) -> NearToken {
    NearToken::from_yoctonear(n)
}

pub struct Env {
    pub sandbox: Sandbox,
    pub net: NetworkConfig,
    pub signer: Arc<Signer>,
    pub vault: AccountId,
    pub usdc: AccountId,
    pub arena: AccountId,
    pub treasury: AccountId,
    pub owner: AccountId,
    pub fighters: [AccountId; 2],
    pub backers: [AccountId; 2],
}

impl Env {
    pub async fn new() -> Env {
        let w = wasms();
        let sandbox = Sandbox::start_sandbox().await.expect("sandbox starts");
        let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse().unwrap());
        let genesis = GenesisAccount::default();
        let signer = Signer::from_secret_key(genesis.private_key.parse().unwrap()).unwrap();
        let id = |name: &str| -> AccountId { format!("{name}.sandbox").parse().unwrap() };
        let env = Env {
            vault: id("vault"),
            usdc: id("usdc"),
            arena: id("arena"),
            treasury: id("treasury"),
            owner: id("owner"),
            fighters: [id("fighter1"), id("fighter2")],
            backers: [id("backer1"), id("backer2")],
            sandbox,
            net,
            signer,
        };
        let mut all = vec![&env.vault, &env.usdc, &env.arena, &env.treasury, &env.owner];
        all.extend(env.fighters.iter());
        all.extend(env.backers.iter());
        for account in all {
            env.sandbox
                .create_account(account.as_str().parse().unwrap())
                .initial_balance(NearToken::from_near(20))
                .send()
                .await
                .expect("account created");
        }
        env.deploy(&env.usdc, &w[1], json!({ "owner_id": env.owner }))
            .await;
        env.deploy(
            &env.vault,
            &w[0],
            json!({
                "owner_id": env.owner,
                "token_id": env.usdc,
                "arena_id": env.arena,
                "treasury_id": env.treasury,
                "demo_mode": true,
            }),
        )
        .await;
        env.deploy(&env.arena, &w[2], json!({})).await;

        for account in [&env.vault, &env.arena, &env.treasury] {
            let _ = env
                .ok(
                    &env.usdc,
                    &env.owner,
                    "storage_deposit",
                    json!({ "account_id": account }),
                    NearToken::from_millinear(10),
                )
                .await;
        }
        let _ = env
            .ok(
                &env.usdc,
                &env.owner,
                "add_minter",
                json!({ "account_id": env.vault }),
                yocto(0),
            )
            .await;
        for role in ["Guardian", "Keeper", "Operator"] {
            let _ = env
                .ok(
                    &env.vault,
                    &env.owner,
                    "grant_role",
                    json!({ "role": role, "account_id": env.owner }),
                    yocto(0),
                )
                .await;
        }
        for user in env.fighters.iter().chain(env.backers.iter()) {
            let _ = env
                .ok(
                    &env.usdc,
                    user,
                    "faucet",
                    json!({}),
                    NearToken::from_millinear(10),
                )
                .await;
            let _ = env
                .ok(
                    &env.vault,
                    user,
                    "storage_deposit",
                    json!({}),
                    NearToken::from_millinear(10),
                )
                .await;
        }
        env
    }

    async fn deploy(&self, account: &AccountId, wasm: &[u8], args: Value) {
        Contract::deploy(account.clone())
            .use_code(wasm.to_vec())
            .with_init_call("new", args)
            .unwrap()
            .with_signer(self.signer.clone())
            .send_to(&self.net)
            .await
            .unwrap()
            .assert_success();
    }

    pub async fn call(
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
            .with_signer(who.clone(), self.signer.clone())
            .send_to(&self.net)
            .await
            .expect("transaction sent")
            .into_full()
            .expect("transaction executed")
    }

    pub async fn ok(
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

    pub async fn view<T: DeserializeOwned + Send + Sync>(
        &self,
        contract: &AccountId,
        method: &str,
        args: Value,
    ) -> T {
        Contract(contract.clone())
            .call_function(method, args)
            .read_only()
            .fetch_from(&self.net)
            .await
            .unwrap_or_else(|e| panic!("view {method} failed: {e:?}"))
            .data
    }

    pub async fn usdc_balance(&self, account: &AccountId) -> u128 {
        let b: String = self
            .view(
                &self.usdc,
                "ft_balance_of",
                json!({ "account_id": account }),
            )
            .await;
        b.parse().unwrap()
    }

    /// `ft_transfer_call` from `who` to the vault; returns the transaction result.
    pub async fn deposit(&self, who: &AccountId, amount: u128, msg: &str) -> ExecutionFinalResult {
        self.call(
            &self.usdc,
            who,
            "ft_transfer_call",
            json!({ "receiver_id": self.vault, "amount": amount.to_string(), "msg": msg }),
            yocto(1),
        )
        .await
    }

    pub async fn withdraw(
        &self,
        who: &AccountId,
        pool: &str,
        amount: u128,
    ) -> ExecutionFinalResult {
        self.call(
            &self.vault,
            who,
            "withdraw",
            json!({ "pool": pool, "amount": amount.to_string() }),
            yocto(1),
        )
        .await
    }

    pub async fn principal(&self, who: &AccountId, pool: &str) -> u128 {
        let p: String = self
            .view(
                &self.vault,
                "principal_of",
                json!({ "pool": pool, "account_id": who }),
            )
            .await;
        p.parse().unwrap()
    }

    pub async fn totals(&self) -> Value {
        self.view(&self.vault, "get_totals", json!({})).await
    }

    /// The no-loss invariant: the vault holds at least all principal plus the held pot.
    pub async fn assert_no_loss(&self, step: &str) {
        let t = self.totals().await;
        let owed = amount(&t["fighter_principal"])
            + amount(&t["backer_principal"])
            + amount(&t["pot_held"]);
        let held = self.usdc_balance(&self.vault).await;
        assert!(
            held >= owed,
            "{step}: vault holds {held} < principal + pot_held {owed}"
        );
    }

    pub async fn set_multiplier(&self, m: u32) {
        let _ = self
            .ok(
                &self.vault,
                &self.owner,
                "set_time_multiplier",
                json!({ "multiplier": m }),
                yocto(0),
            )
            .await;
    }

    pub async fn set_arena_mode(&self, mode: &str) {
        let _ = self
            .ok(
                &self.arena,
                &self.owner,
                "set_mode",
                json!({ "mode": mode }),
                yocto(0),
            )
            .await;
    }

    pub async fn pot_received(&self) -> u128 {
        let (total, _count): (String, u32) =
            self.view(&self.arena, "pot_received", json!({})).await;
        total.parse().unwrap()
    }
}
