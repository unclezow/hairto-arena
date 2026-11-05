//! Sandbox harness: builds `mock-usdc` and `mock-ft-receiver`, starts a local node, creates accounts and deploys.

#![allow(dead_code)]

use std::sync::{Arc, OnceLock};

use near_api::types::transaction::result::ExecutionFinalResult;
use near_api::{AccountId, Contract, NearGas, NearToken, NetworkConfig, Signer, Tokens};
use near_sandbox::{GenesisAccount, Sandbox};
use near_sdk::serde::de::DeserializeOwned;
use serde_json::{json, Value};

pub const ONE_USDC: u128 = 1_000_000;

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

/// `(mock-usdc, mock-ft-receiver)` wasm, built once per test binary.
pub fn wasms() -> &'static (Vec<u8>, Vec<u8>) {
    WASMS.get_or_init(|| (build("mock-usdc"), build("mock-ft-receiver")))
}

pub fn events(res: &ExecutionFinalResult) -> Vec<Value> {
    res.logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .map(|j| serde_json::from_str(j).unwrap())
        .collect()
}

pub fn event(res: &ExecutionFinalResult, standard: &str, name: &str) -> Option<Value> {
    events(res)
        .into_iter()
        .find(|e| e["standard"] == standard && e["event"] == name)
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
    pub usdc: AccountId,
    pub receiver: AccountId,
    pub owner: AccountId,
    pub alice: AccountId,
    pub bob: AccountId,
    pub carol: AccountId,
    pub vault: AccountId,
}

impl Env {
    /// `mock-usdc` at `usdc.sandbox` (owner `owner.sandbox`) and the mock receiver at `receiver.sandbox`.
    pub async fn new() -> Env {
        let (usdc_wasm, receiver_wasm) = wasms().clone();
        let sandbox = Sandbox::start_sandbox().await.expect("sandbox starts");
        let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse().unwrap());
        let genesis = GenesisAccount::default();
        let signer = Signer::from_secret_key(genesis.private_key.parse().unwrap()).unwrap();
        let id = |name: &str| -> AccountId { format!("{name}.sandbox").parse().unwrap() };
        let env = Env {
            usdc: id("usdc"),
            receiver: id("receiver"),
            owner: id("owner"),
            alice: id("alice"),
            bob: id("bob"),
            carol: id("carol"),
            vault: id("vault"),
            sandbox,
            net,
            signer,
        };
        for account in [
            &env.usdc,
            &env.receiver,
            &env.owner,
            &env.alice,
            &env.bob,
            &env.carol,
            &env.vault,
        ] {
            env.sandbox
                .create_account(account.as_str().parse().unwrap())
                .initial_balance(NearToken::from_near(10))
                .send()
                .await
                .expect("account created");
        }
        Contract::deploy(env.usdc.clone())
            .use_code(usdc_wasm)
            .with_init_call("new", json!({ "owner_id": env.owner }))
            .unwrap()
            .with_signer(env.signer.clone())
            .send_to(&env.net)
            .await
            .unwrap()
            .assert_success();
        Contract::deploy(env.receiver.clone())
            .use_code(receiver_wasm)
            .with_init_call("new", json!({}))
            .unwrap()
            .with_signer(env.signer.clone())
            .send_to(&env.net)
            .await
            .unwrap()
            .assert_success();
        env
    }

    pub async fn call(
        &self,
        who: &AccountId,
        method: &str,
        args: Value,
        deposit: NearToken,
    ) -> ExecutionFinalResult {
        Contract(self.usdc.clone())
            .call_function(method, args)
            .transaction()
            .gas(NearGas::from_tgas(100))
            .deposit(deposit)
            .with_signer(who.clone(), self.signer.clone())
            .send_to(&self.net)
            .await
            .expect("transaction sent")
            .into_full()
            .expect("transaction executed")
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

    pub async fn balance(&self, account: &AccountId) -> u128 {
        let b: String = self
            .view(
                &self.usdc,
                "ft_balance_of",
                json!({ "account_id": account }),
            )
            .await;
        b.parse().unwrap()
    }

    pub async fn near_balance(&self, account: &AccountId) -> u128 {
        Tokens::account(account.clone())
            .near_balance()
            .fetch_from(&self.net)
            .await
            .unwrap()
            .total
            .as_yoctonear()
    }

    /// Registers `account` with the storage minimum, paid by `account`.
    pub async fn register(&self, account: &AccountId) {
        let res = self
            .call(
                account,
                "storage_deposit",
                json!({ "account_id": account }),
                NearToken::from_millinear(10),
            )
            .await;
        assert!(is_ok(&res), "{res:?}");
    }
}
