//! `mock-usdc` scenarios with a mocked blockchain.

use std::panic::{catch_unwind, AssertUnwindSafe};

use near_contract_standards::fungible_token::metadata::FungibleTokenMetadataProvider;
use near_contract_standards::fungible_token::{FungibleTokenCore, FungibleTokenResolver};
use near_contract_standards::storage_management::StorageManagement;
use near_sdk::json_types::U128;
use near_sdk::mock::MockAction;
use near_sdk::serde_json::{self, Value};
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, AccountId, NearToken, PromiseResult, RuntimeFeesConfig};

use super::*;

const T0: u64 = 1_800_000_000_000;
const HOUR: u64 = 3_600_000;

fn acc(name: &str) -> AccountId {
    name.parse().unwrap()
}
fn usdc_id() -> AccountId {
    acc("usdc.test.near")
}
fn owner() -> AccountId {
    acc("owner.test.near")
}
fn alice() -> AccountId {
    acc("alice.test.near")
}
fn bob() -> AccountId {
    acc("bob.test.near")
}
fn vault() -> AccountId {
    acc("vault.test.near")
}

fn builder(caller: &AccountId, now_ms: u64, deposit: NearToken) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(usdc_id())
        .predecessor_account_id(caller.clone())
        .signer_account_id(caller.clone())
        .block_timestamp(now_ms * 1_000_000)
        .attached_deposit(deposit);
    b
}

fn ctx(caller: &AccountId, now_ms: u64, deposit: NearToken) {
    testing_env!(builder(caller, now_ms, deposit).build());
}

fn fails<R>(f: impl FnOnce() -> R) -> bool {
    catch_unwind(AssertUnwindSafe(f)).is_err()
}

fn events() -> Vec<Value> {
    get_logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .map(|j| serde_json::from_str(j).unwrap())
        .collect()
}

fn event(standard: &str, name: &str) -> Option<Value> {
    events()
        .into_iter()
        .find(|e| e["standard"] == standard && e["event"] == name)
}

/// NEAR refunded by the call that just ran.
fn refunds_to(account: &AccountId) -> u128 {
    get_created_receipts()
        .iter()
        .filter(|r| &r.receiver_id == account)
        .flat_map(|r| r.actions.iter())
        .map(|a| match a {
            MockAction::Transfer { deposit, .. } => deposit.as_yoctonear(),
            _ => 0,
        })
        .sum()
}

fn zero() -> NearToken {
    NearToken::from_yoctonear(0)
}

fn storage_min(c: &MockUsdc) -> NearToken {
    c.storage_balance_bounds().min
}

fn setup() -> MockUsdc {
    ctx(&owner(), T0, zero());
    MockUsdc::new(owner())
}

/// Registers `account` through `storage_deposit` with the exact minimum.
fn register(c: &mut MockUsdc, account: &AccountId) {
    ctx(account, T0, zero());
    let min = storage_min(c);
    ctx(account, T0, min);
    c.storage_deposit(None, None);
}

fn balance(c: &MockUsdc, account: &AccountId) -> u128 {
    c.ft_balance_of(account.clone()).0
}

#[test]
fn init_metadata_and_supply() {
    let c = setup();
    let m = c.ft_metadata();
    assert_eq!(m.spec, "ft-1.0.0");
    assert_eq!(m.name, "USD Coin (Mock)");
    assert_eq!(m.symbol, "USDC");
    assert_eq!(m.decimals, 6);
    assert!(m.icon.unwrap().starts_with("data:image/svg+xml"));
    assert_eq!(c.ft_total_supply(), U128(0));
    assert_eq!(c.owner_id(), owner());
    // One 64-character account record costs 125 bytes of storage.
    assert_eq!(
        storage_min(&c),
        NearToken::from_yoctonear(1_250_000_000_000_000_000_000)
    );
}

#[test]
fn transfer_between_registered_accounts() {
    let mut c = setup();
    register(&mut c, &alice());
    register(&mut c, &bob());
    c.add_minter_for_test(&vault());
    ctx(&vault(), T0, zero());
    c.mint(alice(), U128(50 * ONE_USDC), None);

    ctx(&alice(), T0, NearToken::from_yoctonear(1));
    c.ft_transfer(bob(), U128(20 * ONE_USDC), None);
    let e = event("nep141", "ft_transfer").unwrap();
    assert_eq!(e["data"][0]["old_owner_id"], alice().as_str());
    assert_eq!(e["data"][0]["amount"], (20 * ONE_USDC).to_string());
    assert_eq!(balance(&c, &alice()), 30 * ONE_USDC);
    assert_eq!(balance(&c, &bob()), 20 * ONE_USDC);
    assert_eq!(c.ft_total_supply(), U128(50 * ONE_USDC));

    // Transfers need exactly one yoctoNEAR, so function-call keys cannot move tokens.
    ctx(&alice(), T0, zero());
    assert!(fails(|| c.ft_transfer(bob(), U128(1), None)));
}

#[test]
fn transfer_to_unregistered_account_fails() {
    let mut c = setup();
    ctx(&alice(), T0, storage_min(&c));
    c.faucet();
    ctx(&alice(), T0, NearToken::from_yoctonear(1));
    // The chain reverts the partial withdrawal; the unit mock does not, so balances are checked in the sandbox test.
    assert!(fails(|| c.ft_transfer(bob(), U128(ONE_USDC), None)));
}

#[test]
fn transfer_call_refund_returns_full_amount() {
    let mut c = setup();
    register(&mut c, &alice());
    register(&mut c, &bob());
    ctx(&alice(), T0, zero());
    c.faucet();
    ctx(&alice(), T0, NearToken::from_yoctonear(1));
    let _ = c.ft_transfer_call(bob(), U128(10 * ONE_USDC), None, "refund".into());
    assert_eq!(balance(&c, &bob()), 10 * ONE_USDC);

    // The receiver answers that the whole amount is unused.
    let unused = serde_json::to_vec(&U128(10 * ONE_USDC)).unwrap();
    testing_env!(
        builder(&usdc_id(), T0, zero()).build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(unused)],
    );
    let used = c.ft_resolve_transfer(alice(), bob(), U128(10 * ONE_USDC));
    assert_eq!(used, U128(0));
    assert_eq!(balance(&c, &alice()), 1_000 * ONE_USDC);
    assert_eq!(balance(&c, &bob()), 0);
}

#[test]
fn first_claim_registers_and_refunds() {
    let mut c = setup();
    ctx(&alice(), T0, NearToken::from_millinear(10));
    assert_eq!(c.faucet(), U128(1_000 * ONE_USDC));
    assert_eq!(balance(&c, &alice()), 1_000 * ONE_USDC);
    assert!(c.storage_balance_of(alice()).is_some());
    // 0.01 NEAR attached, 0.00125 NEAR kept for storage, 0.00875 NEAR refunded.
    assert_eq!(refunds_to(&alice()), 8_750_000_000_000_000_000_000);
    let mint = event("nep141", "ft_mint").unwrap();
    assert_eq!(mint["data"][0]["owner_id"], alice().as_str());
    assert_eq!(mint["data"][0]["amount"], (1_000 * ONE_USDC).to_string());
    let claimed = event("hairto", "faucet_claimed").unwrap();
    assert_eq!(claimed["data"]["next_claim_ms"], T0 + HOUR);
    assert_eq!(c.ft_total_supply(), U128(1_000 * ONE_USDC));
}

#[test]
fn exact_deposit_registers_without_refund() {
    let mut c = setup();
    let min = storage_min(&c);
    ctx(&alice(), T0, min);
    c.faucet();
    assert_eq!(refunds_to(&alice()), 0);
    assert!(c.storage_balance_of(alice()).is_some());
}

#[test]
fn unregistered_without_enough_deposit_fails() {
    let mut c = setup();
    ctx(&alice(), T0, zero());
    assert!(fails(|| c.faucet()));
    let below = NearToken::from_yoctonear(storage_min(&c).as_yoctonear() - 1);
    ctx(&alice(), T0, below);
    assert!(fails(|| c.faucet()));
    assert!(c.storage_balance_of(alice()).is_none());
    assert_eq!(c.ft_total_supply(), U128(0));
}

#[test]
fn registered_caller_gets_deposit_back() {
    let mut c = setup();
    register(&mut c, &alice());
    ctx(&alice(), T0, NearToken::from_millinear(5));
    c.faucet();
    assert_eq!(
        refunds_to(&alice()),
        NearToken::from_millinear(5).as_yoctonear()
    );
}

#[test]
fn cooldown() {
    let mut c = setup();
    register(&mut c, &alice());
    ctx(&alice(), T0, zero());
    c.faucet();
    ctx(&alice(), T0 + 30 * 60_000, zero());
    assert!(fails(|| c.faucet()), "30 minutes later");
    ctx(&alice(), T0 + HOUR - 1, zero());
    assert!(fails(|| c.faucet()));
    ctx(&alice(), T0 + HOUR, zero());
    c.faucet();
    assert_eq!(balance(&c, &alice()), 2_000 * ONE_USDC);
    // Another account is not affected by Alice's cooldown.
    ctx(&bob(), T0 + HOUR, storage_min(&c));
    c.faucet();
}

#[test]
fn faucet_info() {
    let mut c = setup();
    let info = c.faucet_info(alice());
    assert_eq!(info.next_claim_ms, 0, "never claimed");
    assert_eq!(info.faucet_amount, U128(1_000 * ONE_USDC));
    assert_eq!(info.faucet_cooldown_ms, HOUR);
    ctx(&alice(), T0, storage_min(&c));
    c.faucet();
    assert_eq!(c.faucet_info(alice()).next_claim_ms, T0 + HOUR);
}

#[test]
fn vault_mints_yield() {
    let mut c = setup();
    register(&mut c, &vault());
    ctx(&owner(), T0, zero());
    c.add_minter(vault());
    assert_eq!(
        event("hairto", "minter_added").unwrap()["data"]["account_id"],
        vault().as_str()
    );
    assert!(c.is_minter(vault()));
    assert_eq!(c.get_minters(), vec![vault()]);

    ctx(&vault(), T0, zero());
    c.mint(vault(), U128(5 * ONE_USDC), Some("yield".into()));
    let mint = event("nep141", "ft_mint").unwrap();
    assert_eq!(mint["data"][0]["memo"], "yield");
    assert_eq!(balance(&c, &vault()), 5 * ONE_USDC);
    assert_eq!(c.ft_total_supply(), U128(5 * ONE_USDC));
}

#[test]
fn not_a_minter() {
    let mut c = setup();
    register(&mut c, &alice());
    for caller in [alice(), owner()] {
        ctx(&caller, T0, zero());
        assert!(fails(|| c.mint(alice(), U128(ONE_USDC), None)));
    }
    c.add_minter_for_test(&vault());
    ctx(&vault(), T0, zero());
    assert!(
        fails(|| c.mint(bob(), U128(ONE_USDC), None)),
        "unregistered receiver"
    );
    assert!(fails(|| c.mint(alice(), U128(0), None)), "zero amount");

    ctx(&owner(), T0, zero());
    c.remove_minter(vault());
    assert!(event("hairto", "minter_removed").is_some());
    ctx(&vault(), T0, zero());
    assert!(fails(|| c.mint(alice(), U128(ONE_USDC), None)));
    ctx(&alice(), T0, zero());
    assert!(fails(|| c.add_minter(alice())));
}

#[test]
fn bounded_faucet_configuration() {
    let mut c = setup();
    ctx(&owner(), T0, zero());
    assert!(
        fails(|| c.set_faucet_config(None, Some(10_000))),
        "10 s cooldown"
    );
    assert!(fails(|| c.set_faucet_config(None, Some(86_400_001))));
    assert!(fails(|| c.set_faucet_config(Some(U128(ONE_USDC - 1)), None)));
    assert!(fails(
        || c.set_faucet_config(Some(U128(100_000 * ONE_USDC + 1)), None)
    ));
    ctx(&alice(), T0, zero());
    assert!(fails(|| c.set_faucet_config(Some(U128(ONE_USDC)), None)));

    ctx(&owner(), T0, zero());
    c.set_faucet_config(Some(U128(100_000 * ONE_USDC)), Some(60_000));
    let e = event("hairto", "faucet_config_updated").unwrap();
    assert_eq!(e["data"]["faucet_amount"], (100_000 * ONE_USDC).to_string());
    assert_eq!(e["data"]["faucet_cooldown_ms"], 60_000);
    c.set_faucet_config(Some(U128(ONE_USDC)), Some(86_400_000));

    ctx(&alice(), T0, storage_min(&c));
    assert_eq!(c.faucet(), U128(ONE_USDC));
}

#[test]
fn ownership_transfer() {
    let mut c = setup();
    ctx(&alice(), T0, zero());
    assert!(fails(|| c.transfer_ownership(alice())));
    ctx(&owner(), T0, zero());
    c.transfer_ownership(alice());
    assert_eq!(c.owner_id(), alice());
    assert!(fails(|| c.add_minter(vault())));
    ctx(&alice(), T0, zero());
    c.add_minter(vault());
}

impl MockUsdc {
    fn add_minter_for_test(&mut self, minter: &AccountId) {
        ctx(&owner(), T0, zero());
        self.add_minter(minter.clone());
    }
}
