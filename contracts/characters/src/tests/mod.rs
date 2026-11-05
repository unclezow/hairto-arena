//! Unit tests with a mocked blockchain.

// Helpers are shared by several test modules; not every module uses all of them.
#![allow(dead_code)]

mod catalog;

use std::panic::{catch_unwind, AssertUnwindSafe};

use near_sdk::json_types::U128;
use near_sdk::mock::MockAction;
use near_sdk::serde_json::{self, Value};
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, AccountId, Gas, NearToken, PromiseResult, RuntimeFeesConfig};

use crate::{Characters, ONE_USDC};

pub const T0: u64 = 1_800_000_000_000;

pub fn acc(name: &str) -> AccountId {
    name.parse().unwrap()
}
pub fn shop() -> AccountId {
    acc("characters.test.near")
}
pub fn usdc() -> AccountId {
    acc("usdc.test.near")
}
pub fn owner() -> AccountId {
    acc("owner.test.near")
}
pub fn treasury() -> AccountId {
    acc("treasury.test.near")
}
pub fn guardian() -> AccountId {
    acc("guardian.test.near")
}
pub fn minter() -> AccountId {
    acc("minter.test.near")
}
pub fn alice() -> AccountId {
    acc("alice.test.near")
}
pub fn bob() -> AccountId {
    acc("bob.test.near")
}

pub fn usd(n: u128) -> u128 {
    n * ONE_USDC
}

pub fn builder(caller: &AccountId, deposit: NearToken) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(shop())
        .predecessor_account_id(caller.clone())
        .signer_account_id(caller.clone())
        .block_timestamp(T0 * 1_000_000)
        .attached_deposit(deposit)
        .prepaid_gas(Gas::from_tgas(300));
    b
}

pub fn ctx(caller: &AccountId) {
    testing_env!(builder(caller, NearToken::from_yoctonear(0)).build());
}

pub fn ctx_yocto(caller: &AccountId) {
    testing_env!(builder(caller, NearToken::from_yoctonear(1)).build());
}

/// A callback context on the contract itself with one promise result.
pub fn ctx_callback(result: PromiseResult) {
    testing_env!(
        builder(&shop(), NearToken::from_yoctonear(0)).build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
}

pub fn fails<R>(f: impl FnOnce() -> R) -> bool {
    catch_unwind(AssertUnwindSafe(f)).is_err()
}

pub fn events() -> Vec<Value> {
    get_logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .map(|j| serde_json::from_str(j).unwrap())
        .collect()
}

pub fn event(standard: &str, name: &str) -> Option<Value> {
    events()
        .into_iter()
        .find(|e| e["standard"] == standard && e["event"] == name)
}

/// Function calls the contract scheduled, as `(receiver, method, args)`.
pub fn calls() -> Vec<(AccountId, String, Value)> {
    get_created_receipts()
        .iter()
        .flat_map(|r| {
            r.actions.iter().filter_map(move |a| match a {
                MockAction::FunctionCallWeight {
                    method_name, args, ..
                } => Some((
                    r.receiver_id.clone(),
                    String::from_utf8(method_name.clone()).unwrap(),
                    serde_json::from_slice(args).unwrap_or(Value::Null),
                )),
                _ => None,
            })
        })
        .collect()
}

/// A fresh contract with a guardian and a minter. Every call starts from empty storage.
pub fn setup() -> Characters {
    near_sdk::env::set_blockchain_interface(near_sdk::MockedBlockchain::new(
        VMContextBuilder::new().build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        vec![],
        Default::default(),
        Default::default(),
        None,
    ));
    ctx(&owner());
    let mut c = Characters::new(
        owner(),
        usdc(),
        treasury(),
        "https://app.example/characters".into(),
    );
    c.grant_role(crate::Role::Guardian, guardian());
    c.grant_role(crate::Role::Minter, minter());
    c
}

/// The five catalog entries: ids 1–4 (Mage 1, Rogue 2, Rogue Hooded 3, Barbarian 5 USDC, unlimited).
pub fn with_catalog() -> Characters {
    let mut c = setup();
    ctx(&owner());
    for (name, price) in [
        ("Mage", 1),
        ("Rogue", 2),
        ("Rogue (Hooded)", 3),
        ("Barbarian", 5),
    ] {
        c.list_character(name.into(), U128(usd(price)), 0);
    }
    c
}
