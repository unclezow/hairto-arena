//! Sandbox harness: real `mock-usdc`, `characters` registered with it, and `mock-mt-receiver`. Characters 1–4 are
//! listed (Mage 1, Rogue 2, Rogue (Hooded) 3, Barbarian 5 USDC, unlimited); id 0 is the unlisted default. Alice and
//! Bob have 1 000 USDC from the faucet.

#![allow(dead_code)]

use std::sync::{Arc, OnceLock};

use near_api::types::transaction::result::ExecutionFinalResult;
use near_api::{Account, AccountId, Contract, NearGas, NearToken, NetworkConfig, Signer};
use near_sandbox::{GenesisAccount, Sandbox};
use near_sdk::serde::de::DeserializeOwned;
use serde_json::{json, Value};

pub const USDC: u128 = 1_000_000;

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

/// `[characters, mock-usdc, mock-mt-receiver]` wasm, built once per test binary.
pub fn wasms() -> &'static [Vec<u8>] {
    WASMS.get_or_init(|| {
        vec![
            build("characters"),
            build("mock-usdc"),
            build("mock-mt-receiver"),
        ]
    })
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

pub fn yocto(n: u128) -> NearToken {
    NearToken::from_yoctonear(n)
}

pub struct Env {
    pub sandbox: Sandbox,
    pub net: NetworkConfig,
    pub signer: Arc<Signer>,
    pub shop: AccountId,
    pub usdc: AccountId,
    pub receiver: AccountId,
    pub owner: AccountId,
    pub treasury: AccountId,
    pub alice: AccountId,
    pub bob: AccountId,
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
            shop: id("characters"),
            usdc: id("usdc"),
            receiver: id("receiver"),
            owner: id("owner"),
            treasury: id("treasury"),
            alice: id("alice"),
            bob: id("bob"),
            sandbox,
            net,
            signer,
        };
        for account in [
            &env.shop,
            &env.usdc,
            &env.receiver,
            &env.owner,
            &env.treasury,
            &env.alice,
            &env.bob,
        ] {
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
            &env.shop,
            &w[0],
            json!({
                "owner_id": env.owner,
                "token_id": env.usdc,
                "treasury_id": env.treasury,
                "base_uri": "https://app.example/characters",
            }),
        )
        .await;
        env.deploy(&env.receiver, &w[2], json!({})).await;
        let _ = env
            .ok(
                &env.usdc,
                &env.owner,
                "storage_deposit",
                json!({ "account_id": env.shop }),
                NearToken::from_millinear(10),
            )
            .await;
        for (name, price) in [
            ("Mage", 1),
            ("Rogue", 2),
            ("Rogue (Hooded)", 3),
            ("Barbarian", 5),
        ] {
            let _ = env
                .ok(
                    &env.shop,
                    &env.owner,
                    "list_character",
                    json!({ "name": name, "price": (price * USDC).to_string(), "max_supply": 0 }),
                    yocto(0),
                )
                .await;
        }
        let _ = env
            .ok(
                &env.shop,
                &env.owner,
                "grant_role",
                json!({ "role": "Guardian", "account_id": env.owner }),
                yocto(0),
            )
            .await;
        for user in [&env.alice, &env.bob] {
            let _ = env
                .ok(
                    &env.usdc,
                    user,
                    "faucet",
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
            .gas(NearGas::from_tgas(150))
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

    pub async fn copies(&self, account: &AccountId, token_id: &str) -> u128 {
        let b: String = self
            .view(
                &self.shop,
                "mt_balance_of",
                json!({ "account_id": account, "token_id": token_id }),
            )
            .await;
        b.parse().unwrap()
    }

    pub async fn equipped(&self, account: &AccountId) -> String {
        self.view(&self.shop, "equipped_of", json!({ "account_id": account }))
            .await
    }

    pub async fn storage_usage(&self, account: &AccountId) -> u64 {
        Account(account.clone())
            .view()
            .fetch_from(&self.net)
            .await
            .unwrap()
            .data
            .storage_usage
    }

    /// USDC `ft_transfer_call` to the shop with `{"buy":"<id>"}`.
    pub async fn buy(&self, who: &AccountId, id: &str, amount: u128) -> ExecutionFinalResult {
        self.call(
            &self.usdc,
            who,
            "ft_transfer_call",
            json!({ "receiver_id": self.shop, "amount": amount.to_string(), "msg": format!(r#"{{"buy":"{id}"}}"#) }),
            yocto(1),
        )
        .await
    }

    pub async fn transfer(
        &self,
        from: &AccountId,
        to: &AccountId,
        id: &str,
    ) -> ExecutionFinalResult {
        self.call(
            &self.shop,
            from,
            "mt_transfer",
            json!({ "receiver_id": to, "token_id": id, "amount": "1", "approval": null, "memo": null }),
            yocto(1),
        )
        .await
    }

    pub async fn set_receiver_mode(&self, mode: &str, forward_to: Option<&AccountId>) {
        let _ = self
            .ok(
                &self.receiver,
                &self.owner,
                "set_mode",
                json!({ "mode": mode, "forward_to": forward_to }),
                yocto(0),
            )
            .await;
    }
}
