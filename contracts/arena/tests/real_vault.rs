//! The arena against the real `vault` (with `mock-usdc`) instead of `mock-vault`: `can_play` gates duels.

mod common;

use common::*;
use near_api::{AccountId, Contract, NearGas, NearToken};
use serde_json::{json, Value};

async fn call(
    env: &Env,
    contract: &AccountId,
    who: &AccountId,
    method: &str,
    args: Value,
    deposit: NearToken,
) {
    let res = Contract(contract.clone())
        .call_function(method, args.clone())
        .transaction()
        .gas(NearGas::from_tgas(100))
        .deposit(deposit)
        .with_signer(who.clone(), env.signer.clone())
        .send_to(&env.net)
        .await
        .expect("transaction sent")
        .into_full()
        .expect("transaction executed");
    assert!(is_ok(&res), "{method}({args}) failed: {res:?}");
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

#[tokio::test]
async fn real_vault_gates_duels() {
    let env = Env::new().await;
    let usdc: AccountId = "usdc.sandbox".parse().unwrap();
    let vault: AccountId = "realvault.sandbox".parse().unwrap();
    deploy(&env, &usdc, "mock-usdc", json!({ "owner_id": env.owner })).await;
    deploy(
        &env,
        &vault,
        "vault",
        json!({
            "owner_id": env.owner,
            "token_id": usdc,
            "arena_id": env.arena,
            "treasury_id": env.owner,
            "demo_mode": false,
        }),
    )
    .await;
    let owner = env.owner.clone();
    call(
        &env,
        &usdc,
        &owner,
        "storage_deposit",
        json!({ "account_id": vault }),
        NearToken::from_millinear(10),
    )
    .await;
    let _ = env
        .ok(&owner, "set_vault_id", json!({ "vault_id": vault }))
        .await;

    // No deposit yet: the vault says no.
    let res = env.start_duel([1; 32]).await;
    assert_eq!(
        event(&res, "duel_rejected").unwrap()["data"]["reason"],
        "not_eligible"
    );

    // Faucet, register with the vault, deposit 10 USDC into the Fighter pool.
    let fighter = env.fighter.clone();
    call(
        &env,
        &usdc,
        &fighter,
        "faucet",
        json!({}),
        NearToken::from_millinear(10),
    )
    .await;
    call(
        &env,
        &vault,
        &fighter,
        "storage_deposit",
        json!({}),
        NearToken::from_millinear(10),
    )
    .await;
    call(
        &env,
        &usdc,
        &fighter,
        "ft_transfer_call",
        json!({ "receiver_id": vault, "amount": "10000000", "msg": r#"{"pool":"Fighter"}"# }),
        NearToken::from_yoctonear(1),
    )
    .await;

    env.wait_fresh().await;
    let res = env.start_duel([2; 32]).await;
    assert!(event(&res, "duel_created").is_some(), "{res:?}");
}
