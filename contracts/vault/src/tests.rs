//! `vault-admin`, `vault-accounts` and `vault-yield` scenarios with a mocked blockchain. Callbacks are driven with
//! simulated promise results.

use std::panic::{catch_unwind, AssertUnwindSafe};

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::U128;
use near_sdk::mock::MockAction;
use near_sdk::serde_json::{self, Value};
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{
    testing_env, AccountId, Gas, NearToken, PromiseOrValue, PromiseResult, RuntimeFeesConfig,
};

use super::*;
use crate::accrual::{mul_div, split, YEAR_MS};
use crate::admin::Role;
use crate::pool::Pool;

const T0: u64 = 1_800_000_000_000;
const HOUR: u64 = 3_600_000;
const DAY: u64 = 24 * HOUR;
const YEAR: u64 = YEAR_MS as u64;

fn acc(name: &str) -> AccountId {
    name.parse().unwrap()
}
fn vault_id() -> AccountId {
    acc("vault.test.near")
}
fn usdc() -> AccountId {
    acc("usdc.test.near")
}
fn arena() -> AccountId {
    acc("arena.test.near")
}
fn treasury() -> AccountId {
    acc("treasury.test.near")
}
fn owner() -> AccountId {
    acc("owner.test.near")
}
fn guardian() -> AccountId {
    acc("guardian.test.near")
}
fn keeper() -> AccountId {
    acc("keeper.test.near")
}
fn operator() -> AccountId {
    acc("ops.test.near")
}
fn fighter() -> AccountId {
    acc("fighter.test.near")
}
fn backer() -> AccountId {
    acc("backer.test.near")
}
fn backer2() -> AccountId {
    acc("backer2.test.near")
}

fn usd(n: u128) -> u128 {
    n * ONE_USDC
}

fn builder(caller: &AccountId, now_ms: u64, deposit: NearToken) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(vault_id())
        .predecessor_account_id(caller.clone())
        .signer_account_id(caller.clone())
        .block_timestamp(now_ms * 1_000_000)
        .attached_deposit(deposit)
        .prepaid_gas(Gas::from_tgas(300));
    b
}

fn ctx(caller: &AccountId, now_ms: u64) {
    testing_env!(builder(caller, now_ms, NearToken::from_yoctonear(0)).build());
}

fn ctx_deposit(caller: &AccountId, now_ms: u64, deposit: NearToken) {
    testing_env!(builder(caller, now_ms, deposit).build());
}

/// A callback context on the vault itself with one promise result.
fn ctx_callback(now_ms: u64, result: PromiseResult) {
    testing_env!(
        builder(&vault_id(), now_ms, NearToken::from_yoctonear(0)).build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
}

fn ok() -> PromiseResult {
    PromiseResult::Successful(vec![])
}

fn used(amount: u128) -> PromiseResult {
    PromiseResult::Successful(serde_json::to_vec(&U128(amount)).unwrap())
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

fn event(name: &str) -> Option<Value> {
    events().into_iter().find(|e| e["event"] == name)
}

fn transfers_to(account: &AccountId) -> u128 {
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

/// Function calls the vault scheduled, as `(receiver, method, args)`.
fn calls() -> Vec<(AccountId, String, Value)> {
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

fn setup_with(demo_mode: bool) -> Vault {
    ctx(&owner(), T0);
    let mut v = Vault::new(owner(), usdc(), arena(), treasury(), demo_mode);
    v.grant_role(Role::Guardian, guardian());
    v.grant_role(Role::Keeper, keeper());
    v.grant_role(Role::Operator, operator());
    v
}

fn setup() -> Vault {
    setup_with(true)
}

fn register(v: &mut Vault, account: &AccountId, now: u64) {
    ctx_deposit(account, now, account::ACCOUNT_STORAGE_FEE);
    v.storage_deposit(None);
}

/// `ft_on_transfer` from the token; returns the unused amount.
fn transfer_in(v: &mut Vault, sender: &AccountId, amount: u128, msg: &str, now: u64) -> u128 {
    ctx(&usdc(), now);
    match v.ft_on_transfer(sender.clone(), U128(amount), msg.to_string()) {
        PromiseOrValue::Value(unused) => unused.0,
        PromiseOrValue::Promise(_) => panic!("deposits never return a promise"),
    }
}

const FIGHTER_MSG: &str = r#"{"pool":"Fighter"}"#;
const BACKER_MSG: &str = r#"{"pool":"Backer"}"#;

fn deposit(v: &mut Vault, who: &AccountId, pool: Pool, amount: u128, now: u64) {
    let msg = if pool == Pool::Fighter {
        FIGHTER_MSG
    } else {
        BACKER_MSG
    };
    assert_eq!(transfer_in(v, who, amount, msg, now), 0, "deposit accepted");
}

fn withdraw_ok(v: &mut Vault, who: &AccountId, pool: Pool, amount: u128, now: u64) {
    ctx_deposit(who, now, NearToken::from_yoctonear(1));
    let _ = v.withdraw(pool, U128(amount));
    ctx_callback(now, ok());
    v.on_withdrawn(who.clone(), pool, U128(amount));
}

fn totals(v: &Vault, now: u64) -> admin::TotalsView {
    ctx(&keeper(), now);
    v.get_totals()
}

// ================================================================ vault-admin

#[test]
fn init_defaults() {
    let v = setup_with(false);
    let c = v.get_config();
    assert_eq!(c.fighter.min_deposit, U128(usd(10)));
    assert_eq!((c.fighter.fee_bps, c.fighter.owner_share_bps), (500, 0));
    assert_eq!(c.backer.min_deposit, U128(usd(100)));
    assert_eq!((c.backer.fee_bps, c.backer.owner_share_bps), (1_000, 5_000));
    assert_eq!((c.apy_bps, c.time_multiplier), (500, 1));
    assert_eq!(
        (c.token_id, c.arena_id, c.treasury_id),
        (usdc(), arena(), treasury())
    );
    assert!(!c.demo_mode && !c.paused);
    let r = v.get_roles();
    assert_eq!(
        (r.guardians, r.keepers, r.operators),
        (vec![guardian()], vec![keeper()], vec![operator()])
    );
}

#[test]
fn owner_gates() {
    let mut v = setup();
    ctx(&fighter(), T0);
    assert!(
        fails(|| v.set_treasury(fighter())),
        "non-owner sets treasury"
    );
    assert!(fails(|| v.set_arena_id(fighter())));
    assert!(fails(|| v.grant_role(Role::Keeper, fighter())));
    assert!(fails(|| v.transfer_ownership(fighter())));
    assert!(fails(|| v.pause()));
    assert!(fails(|| v.set_time_multiplier(10)));
    assert!(fails(|| v.clear_stale_payouts()));
    ctx(&owner(), T0);
    assert!(fails(|| v.pause()), "the owner holds no role implicitly");
    v.set_treasury(acc("dao.test.near"));
    v.set_arena_id(acc("arena2.test.near"));
    v.revoke_role(Role::Keeper, keeper());
    assert!(!v.has_role(Role::Keeper, keeper()));
    v.transfer_ownership(acc("dao.test.near"));
    let c = v.get_config();
    assert_eq!(
        (c.owner_id, c.treasury_id, c.arena_id),
        (
            acc("dao.test.near"),
            acc("dao.test.near"),
            acc("arena2.test.near")
        )
    );
}

#[test]
fn bounded_configuration() {
    let mut v = setup();
    ctx(&owner(), T0);
    assert!(
        fails(|| v.set_pool_config(Pool::Backer, None, Some(2_001), None)),
        "fee above cap"
    );
    assert!(fails(|| v.set_pool_config(
        Pool::Backer,
        None,
        None,
        Some(10_001)
    )));
    assert!(fails(|| v.set_pool_config(
        Pool::Fighter,
        Some(U128(0)),
        None,
        None
    )));
    assert!(fails(|| v.set_apy_bps(5_001)));
    v.set_pool_config(Pool::Backer, Some(U128(usd(50))), Some(2_000), Some(10_000));
    let e = event("vault_config_updated").unwrap();
    assert_eq!(e["data"]["pool"], "Backer");
    assert_eq!(e["data"]["config"]["fee_bps"], 2_000);
    v.set_apy_bps(0);
    assert_eq!(
        event("vault_yield_rate_updated").unwrap()["data"]["apy_bps"],
        0
    );
    assert_eq!(v.yield_rate().apy_bps, 0);
    ctx(&fighter(), T0);
    assert!(fails(|| v.set_apy_bps(100)));
}

#[test]
fn rate_change_accrues_first() {
    let mut v = setup();
    register(&mut v, &fighter(), T0);
    deposit(&mut v, &fighter(), Pool::Fighter, usd(1_000), T0);
    // A full year at 5% accrues 50 USDC gross; then the rate drops to 0 for another year.
    ctx(&owner(), T0 + YEAR);
    v.set_apy_bps(0);
    let t = totals(&v, T0 + 2 * YEAR);
    assert_eq!(t.pending_fee.0 + t.pending_pot.0, usd(50));
    assert_eq!(t.pending_fee, U128(2_500_000));
}

#[test]
fn time_multiplier_needs_demo_mode() {
    let mut v = setup_with(false);
    ctx(&operator(), T0);
    assert!(fails(|| v.set_time_multiplier(100_000)), "not in demo mode");

    let mut v = setup();
    ctx(&operator(), T0);
    assert!(fails(|| v.set_time_multiplier(0)));
    assert!(fails(|| v.set_time_multiplier(1_000_001)));
    ctx(&owner(), T0);
    assert!(fails(|| v.set_time_multiplier(10)), "operator only");
}

#[test]
fn accelerated_demo() {
    let mut v = setup();
    register(&mut v, &fighter(), T0);
    deposit(&mut v, &fighter(), Pool::Fighter, usd(1_000), T0);
    ctx(&operator(), T0);
    v.set_time_multiplier(100_000);
    let t = totals(&v, T0 + 5 * 60_000);
    let gross = t.pending_fee.0 + t.pending_pot.0;
    // 1 000 × 5% × 100 000 × 300 s / 1 year ≈ 47.56 USDC.
    assert_eq!(gross, 47_564_687);
}

#[test]
fn register_storage() {
    let mut v = setup();
    ctx_deposit(&fighter(), T0, NearToken::from_millinear(20));
    let b = v.storage_deposit(None);
    assert_eq!(b.total, NearToken::from_millinear(10));
    assert_eq!(
        transfers_to(&fighter()),
        NearToken::from_millinear(10).as_yoctonear()
    );
    assert!(event("vault_registered").is_some());
    assert!(v.storage_balance_of(fighter()).is_some());

    // Already registered: everything is refunded.
    ctx_deposit(&fighter(), T0, NearToken::from_millinear(10));
    v.storage_deposit(None);
    assert_eq!(
        transfers_to(&fighter()),
        NearToken::from_millinear(10).as_yoctonear()
    );

    // Too little.
    ctx_deposit(&backer(), T0, NearToken::from_millinear(9));
    assert!(fails(|| v.storage_deposit(None)));
    // For another account.
    ctx_deposit(&fighter(), T0, NearToken::from_millinear(10));
    v.storage_deposit(Some(backer()));
    assert!(v.storage_balance_of(backer()).is_some());
    assert!(v.storage_balance_of(acc("nobody.test.near")).is_none());
}

#[test]
fn pause_blocks_only_deposits() {
    let mut v = setup();
    register(&mut v, &fighter(), T0);
    deposit(&mut v, &fighter(), Pool::Fighter, usd(20), T0);
    ctx(&guardian(), T0);
    v.pause();
    assert!(event("vault_paused").is_some());
    assert_eq!(
        transfer_in(&mut v, &fighter(), usd(5), FIGHTER_MSG, T0),
        usd(5)
    );
    assert_eq!(
        event("vault_deposit_rejected").unwrap()["data"]["reason"],
        "paused"
    );
    withdraw_ok(&mut v, &fighter(), Pool::Fighter, usd(5), T0 + 1);
    assert_eq!(v.principal_of(Pool::Fighter, fighter()), U128(usd(15)));
    ctx(&guardian(), T0);
    v.unpause();
    deposit(&mut v, &fighter(), Pool::Fighter, usd(5), T0 + 2);
}

#[test]
fn live_pending_values() {
    let mut v = setup();
    register(&mut v, &fighter(), T0);
    deposit(&mut v, &fighter(), Pool::Fighter, usd(1_000), T0);
    let t = totals(&v, T0 + HOUR);
    let gross = mul_div(usd(1_000), 500 * u128::from(HOUR), 10_000 * YEAR_MS);
    assert!(gross > 0);
    let (fee, pot, _) = split(gross, 500, 0);
    assert_eq!((t.pending_fee.0, t.pending_pot.0), (fee, pot));
    assert_eq!(t.fighter_principal, U128(usd(1_000)));
    assert_eq!(t.backer_principal, U128(0));
    // The view did not change state.
    assert_eq!(v.pending_fee, 0);
}

// ================================================================ vault-accounts

#[test]
fn fighter_first_deposit() {
    let mut v = setup();
    register(&mut v, &fighter(), T0);
    assert_eq!(v.role_of(fighter()), None);
    deposit(&mut v, &fighter(), Pool::Fighter, usd(10), T0);
    let e = event("vault_deposited").unwrap();
    assert_eq!(e["data"]["principal"], usd(10).to_string());
    assert_eq!(v.principal_of(Pool::Fighter, fighter()), U128(usd(10)));
    assert_eq!(v.role_of(fighter()), Some(Pool::Fighter));
    assert!(v.can_play(fighter()));
    assert!(!v.can_pick(fighter()));
    assert_eq!(v.principal_of(Pool::Backer, fighter()), U128(0));
}

#[test]
fn rejected_deposits_are_refunded() {
    let mut v = setup();
    // Not registered.
    assert_eq!(
        transfer_in(&mut v, &fighter(), usd(20), FIGHTER_MSG, T0),
        usd(20)
    );
    assert_eq!(
        event("vault_deposit_rejected").unwrap()["data"]["reason"],
        "not_registered"
    );
    register(&mut v, &fighter(), T0);
    // Below minimum.
    assert_eq!(
        transfer_in(&mut v, &fighter(), usd(5), FIGHTER_MSG, T0),
        usd(5)
    );
    assert_eq!(
        event("vault_deposit_rejected").unwrap()["data"]["reason"],
        "below_minimum"
    );
    // Bad messages.
    for msg in [
        "",
        "Fighter",
        r#"{"pool":"Sponsor"}"#,
        r#"{"pol":"Fighter"}"#,
    ] {
        assert_eq!(transfer_in(&mut v, &fighter(), usd(20), msg, T0), usd(20));
        assert_eq!(
            event("vault_deposit_rejected").unwrap()["data"]["reason"],
            "bad_msg"
        );
    }
    assert_eq!(v.role_of(fighter()), None);
    assert_eq!(v.get_totals().fighter_principal, U128(0));
}

#[test]
fn small_top_up() {
    let mut v = setup();
    register(&mut v, &fighter(), T0);
    deposit(&mut v, &fighter(), Pool::Fighter, usd(10), T0);
    deposit(&mut v, &fighter(), Pool::Fighter, usd(2), T0 + 1);
    assert_eq!(v.principal_of(Pool::Fighter, fighter()), U128(usd(12)));
}

#[test]
fn another_token_fails() {
    let mut v = setup();
    register(&mut v, &fighter(), T0);
    ctx(&acc("fake-usdc.test.near"), T0);
    assert!(fails(|| v.ft_on_transfer(
        fighter(),
        U128(usd(20)),
        FIGHTER_MSG.into()
    )));
}

#[test]
fn one_account_one_role() {
    let mut v = setup();
    register(&mut v, &backer(), T0);
    deposit(&mut v, &backer(), Pool::Backer, usd(100), T0);
    assert_eq!(
        transfer_in(&mut v, &backer(), usd(10), FIGHTER_MSG, T0),
        usd(10)
    );
    assert_eq!(
        event("vault_deposit_rejected").unwrap()["data"]["reason"],
        "role_conflict"
    );
    assert!(v.can_pick(backer()));
    assert!(!v.can_play(backer()));
}

#[test]
fn full_exit_releases_the_role() {
    let mut v = setup();
    register(&mut v, &fighter(), T0);
    deposit(&mut v, &fighter(), Pool::Fighter, usd(20), T0);
    ctx_deposit(&fighter(), T0 + 1, NearToken::from_yoctonear(1));
    let _ = v.withdraw(Pool::Fighter, U128(usd(20)));
    // In flight: the role is kept until the transfer is confirmed.
    assert_eq!(v.role_of(fighter()), Some(Pool::Fighter));
    ctx_callback(T0 + 2, ok());
    v.on_withdrawn(fighter(), Pool::Fighter, U128(usd(20)));
    assert!(event("vault_withdrawn").is_some());
    let released = event("vault_role_released").unwrap();
    assert_eq!(released["data"]["pool"], "Fighter");
    assert_eq!(
        transfers_to(&fighter()),
        account::ACCOUNT_STORAGE_FEE.as_yoctonear()
    );
    assert_eq!(v.role_of(fighter()), None);
    assert!(v.storage_balance_of(fighter()).is_none());

    // The account can register again and back.
    register(&mut v, &fighter(), T0 + 3);
    deposit(&mut v, &fighter(), Pool::Backer, usd(100), T0 + 3);
    assert_eq!(v.role_of(fighter()), Some(Pool::Backer));
}

#[test]
fn withdraw_rules() {
    let mut v = setup();
    register(&mut v, &fighter(), T0);
    deposit(&mut v, &fighter(), Pool::Fighter, usd(12), T0);
    // Function-call key: no yoctoNEAR.
    ctx(&fighter(), T0);
    assert!(fails(|| v.withdraw(Pool::Fighter, U128(usd(1)))));
    ctx_deposit(&fighter(), T0, NearToken::from_yoctonear(2));
    assert!(fails(|| v.withdraw(Pool::Fighter, U128(usd(1)))));
    ctx_deposit(&fighter(), T0, NearToken::from_yoctonear(1));
    assert!(
        fails(|| v.withdraw(Pool::Fighter, U128(usd(13)))),
        "over-withdraw"
    );
    assert!(fails(|| v.withdraw(Pool::Fighter, U128(0))));
    assert!(
        fails(|| v.withdraw(Pool::Backer, U128(usd(1)))),
        "wrong pool"
    );
    let mut low_gas = builder(&fighter(), T0, NearToken::from_yoctonear(1));
    low_gas.prepaid_gas(Gas::from_tgas(29));
    testing_env!(low_gas.build());
    assert!(fails(|| v.withdraw(Pool::Fighter, U128(usd(1)))));

    // 12 - 5 = 7 is below the Fighter minimum.
    withdraw_ok(&mut v, &fighter(), Pool::Fighter, usd(5), T0 + 1);
    assert!(!v.can_play(fighter()));
    assert_eq!(v.role_of(fighter()), Some(Pool::Fighter));
}

#[test]
fn backer_withdraws_part() {
    let mut v = setup();
    register(&mut v, &backer(), T0);
    deposit(&mut v, &backer(), Pool::Backer, usd(150), T0);
    ctx_deposit(&backer(), T0 + 1, NearToken::from_yoctonear(1));
    let _ = v.withdraw(Pool::Backer, U128(usd(50)));
    let transfer = calls().into_iter().find(|c| c.1 == "ft_transfer").unwrap();
    assert_eq!(transfer.0, usdc());
    assert_eq!(transfer.2["receiver_id"], backer().as_str());
    assert_eq!(transfer.2["amount"], usd(50).to_string());
    ctx_callback(T0 + 2, ok());
    v.on_withdrawn(backer(), Pool::Backer, U128(usd(50)));
    assert_eq!(v.principal_of(Pool::Backer, backer()), U128(usd(100)));
}

#[test]
fn failed_transfer_restores_principal() {
    let mut v = setup();
    register(&mut v, &fighter(), T0);
    deposit(&mut v, &fighter(), Pool::Fighter, usd(20), T0);
    ctx_deposit(&fighter(), T0 + 1, NearToken::from_yoctonear(1));
    let _ = v.withdraw(Pool::Fighter, U128(usd(20)));
    ctx_callback(T0 + 2, PromiseResult::Failed);
    v.on_withdrawn(fighter(), Pool::Fighter, U128(usd(20)));
    assert!(event("vault_withdraw_failed").is_some());
    assert_eq!(v.principal_of(Pool::Fighter, fighter()), U128(usd(20)));
    assert_eq!(v.get_totals().fighter_principal, U128(usd(20)));
    assert!(v.can_play(fighter()));
}

#[test]
fn claim_cannot_release_during_withdrawal() {
    let mut v = setup();
    register(&mut v, &backer(), T0);
    deposit(&mut v, &backer(), Pool::Backer, usd(1_000), T0);
    // Withdraw everything while yield is owed, then claim before the withdrawal callback.
    ctx_deposit(&backer(), T0 + DAY, NearToken::from_yoctonear(1));
    let _ = v.withdraw(Pool::Backer, U128(usd(1_000)));
    ctx_deposit(&backer(), T0 + DAY, NearToken::from_yoctonear(1));
    let _ = v.claim_yield();
    let owed = calls().into_iter().find(|c| c.1 == "mint").unwrap().2["amount"].clone();
    let owed: u128 = owed.as_str().unwrap().parse().unwrap();
    ctx_callback(T0 + DAY, ok());
    v.on_claimed(backer(), U128(owed));
    assert_eq!(
        v.role_of(backer()),
        Some(Pool::Backer),
        "not released while the withdrawal is in flight"
    );
    ctx_callback(T0 + DAY, PromiseResult::Failed);
    v.on_withdrawn(backer(), Pool::Backer, U128(usd(1_000)));
    assert_eq!(v.principal_of(Pool::Backer, backer()), U128(usd(1_000)));
}

#[test]
fn twab_half_the_range() {
    let mut v = setup();
    register(&mut v, &backer(), T0);
    deposit(&mut v, &backer(), Pool::Backer, usd(200), T0 + 1_000);
    ctx(&keeper(), T0 + 2_000);
    assert_eq!(v.twab_of(backer(), T0, T0 + 2_000), U128(usd(100)));
    assert_eq!(v.twab_of(backer(), T0 + 1_000, T0 + 2_000), U128(usd(200)));
    assert!(fails(|| v.twab_of(backer(), T0 + 2_000, T0 + 2_000)));
    assert!(
        fails(|| v.twab_of(backer(), T0, T0 + 2_001)),
        "to is in the future"
    );
    assert_eq!(v.twab_of(acc("nobody.test.near"), T0, T0 + 1), U128(0));
}

#[test]
fn twab_follows_changes_and_overwrites() {
    let mut v = setup();
    register(&mut v, &backer(), T0);
    deposit(&mut v, &backer(), Pool::Backer, usd(100), T0);
    deposit(&mut v, &backer(), Pool::Backer, usd(100), T0); // same millisecond: overwrites to 200
    withdraw_ok(&mut v, &backer(), Pool::Backer, usd(150), T0 + 1_000);
    ctx(&keeper(), T0 + 3_000);
    // 200 for 1 s, then 50 for 2 s: (200 + 100) / 3 = 100.
    assert_eq!(v.twab_of(backer(), T0, T0 + 3_000), U128(usd(100)));
    assert_eq!(v.twab_len.get(&backer()).copied(), Some(2));
}

// ================================================================ vault-yield

#[test]
fn one_year_at_five_percent() {
    let mut v = setup();
    register(&mut v, &fighter(), T0);
    deposit(&mut v, &fighter(), Pool::Fighter, usd(1_000), T0);
    let t = totals(&v, T0 + YEAR);
    assert_eq!(t.pending_fee.0 + t.pending_pot.0, usd(50));
}

#[test]
fn fighter_pool_split() {
    let mut v = setup();
    register(&mut v, &fighter(), T0);
    deposit(&mut v, &fighter(), Pool::Fighter, usd(2_000), T0);
    // 2 000 × 5% = 100 USDC gross: fee 5, pot 95, nothing owed.
    let t = totals(&v, T0 + YEAR);
    assert_eq!((t.pending_fee.0, t.pending_pot.0), (usd(5), usd(95)));
    assert_eq!(v.claimable_yield_of(fighter()), U128(0));
}

#[test]
fn backer_pool_split() {
    let mut v = setup();
    register(&mut v, &backer(), T0);
    deposit(&mut v, &backer(), Pool::Backer, usd(2_000), T0);
    let t = totals(&v, T0 + YEAR);
    assert_eq!((t.pending_fee.0, t.pending_pot.0), (usd(10), usd(45)));
    assert_eq!(v.claimable_yield_of(backer()), U128(usd(45)));
    let view = v.get_account(backer()).unwrap();
    assert_eq!(view.claimable_yield, U128(usd(45)));
}

#[test]
fn late_depositor_earns_from_its_deposit() {
    let mut v = setup();
    register(&mut v, &backer(), T0);
    register(&mut v, &backer2(), T0);
    deposit(&mut v, &backer(), Pool::Backer, usd(100), T0);
    deposit(&mut v, &backer2(), Pool::Backer, usd(100), T0 + DAY / 2);
    ctx(&keeper(), T0 + DAY);
    let x = v.claimable_yield_of(backer()).0;
    let y = v.claimable_yield_of(backer2()).0;
    assert!(y > 0);
    assert!(x == 2 * y || x == 2 * y + 1, "x={x} y={y}");
}

#[test]
fn owed_never_exceeds_pool_owner_yield() {
    let mut v = setup();
    for (i, who) in [backer(), backer2()].iter().enumerate() {
        register(&mut v, who, T0);
        deposit(
            &mut v,
            who,
            Pool::Backer,
            usd(100 + 37 * i as u128) + 13,
            T0 + i as u64 * 7_777,
        );
    }
    ctx(&owner(), T0 + DAY + 3);
    v.harvest();
    let owners = event("vault_harvested").unwrap()["data"]["backer"]["owners"]
        .as_str()
        .unwrap()
        .parse::<u128>()
        .unwrap();
    ctx(&keeper(), T0 + DAY + 3);
    let sum = v.claimable_yield_of(backer()).0 + v.claimable_yield_of(backer2()).0;
    assert!(
        sum <= owners && owners - sum <= 2,
        "sum={sum} owners={owners}"
    );
}

fn harvest_setup() -> Vault {
    // 2 000 USDC Fighter for a year (fee 5, pot 95) and 1 000 USDC Backer (fee 5, pot 22.5, owed 22.5).
    let mut v = setup();
    register(&mut v, &fighter(), T0);
    register(&mut v, &backer(), T0);
    deposit(&mut v, &fighter(), Pool::Fighter, usd(2_000), T0);
    deposit(&mut v, &backer(), Pool::Backer, usd(1_000), T0);
    v
}

#[test]
fn normal_harvest() {
    let mut v = harvest_setup();
    let now = T0 + YEAR;
    ctx(&keeper(), now);
    v.harvest();
    let h = event("vault_harvested").unwrap();
    assert_eq!(h["data"]["fee"], usd(10).to_string());
    assert_eq!(h["data"]["pot"], 117_500_000u128.to_string());
    assert_eq!(h["data"]["fighter"]["pot"], usd(95).to_string());
    assert_eq!(h["data"]["backer"]["owners"], 22_500_000u128.to_string());
    let mints: Vec<_> = calls().into_iter().filter(|c| c.1 == "mint").collect();
    assert_eq!(mints.len(), 2);
    assert_eq!(mints[0].2["account_id"], treasury().as_str());
    assert_eq!(mints[1].2["account_id"], vault_id().as_str());
    assert_eq!(v.payouts_in_flight, 2);
    assert_eq!((v.pending_fee, v.pending_pot), (0, 0));
    assert!(fails(|| v.harvest()), "payouts in flight");

    ctx_callback(now, ok());
    v.on_fee_minted(U128(usd(10)));
    assert!(event("vault_fee_paid").is_some());
    ctx_callback(now, ok());
    let _ = v.on_pot_minted(U128(117_500_000));
    let send = calls()
        .into_iter()
        .find(|c| c.1 == "ft_transfer_call")
        .unwrap();
    assert_eq!(send.2["receiver_id"], arena().as_str());
    assert_eq!(send.2["msg"], "fund_pot");
    assert_eq!(send.2["amount"], 117_500_000u128.to_string());
    ctx_callback(now, used(117_500_000));
    v.on_pot_sent(U128(117_500_000));
    assert_eq!(
        event("vault_pot_funded").unwrap()["data"]["amount"],
        117_500_000u128.to_string()
    );
    assert_eq!((v.pot_held, v.payouts_in_flight), (0, 0));
    let t = totals(&v, now);
    assert_eq!((t.pending_fee.0, t.pending_pot.0), (0, 0));
}

#[test]
fn arena_returns_the_pot_and_flush_resends() {
    let mut v = harvest_setup();
    let now = T0 + YEAR;
    ctx(&keeper(), now);
    v.harvest();
    ctx_callback(now, ok());
    v.on_fee_minted(U128(usd(10)));
    ctx_callback(now, ok());
    let _ = v.on_pot_minted(U128(117_500_000));
    ctx_callback(now, used(0));
    v.on_pot_sent(U128(117_500_000));
    assert_eq!(
        event("vault_payout_failed").unwrap()["data"]["kind"],
        "pot_returned"
    );
    assert_eq!(v.pot_held, 117_500_000);
    assert_eq!(v.get_totals().pot_held, U128(117_500_000));

    ctx(&keeper(), now + 1);
    v.flush_payouts();
    let sends: Vec<_> = calls()
        .into_iter()
        .filter(|c| c.1 == "ft_transfer_call")
        .collect();
    assert_eq!(sends.len(), 1, "held pot is sent without minting");
    assert!(calls().iter().all(|c| c.1 != "mint"));
    ctx_callback(now + 1, used(117_500_000));
    v.on_pot_sent(U128(117_500_000));
    assert_eq!(v.pot_held, 0);
}

#[test]
fn failed_mints_restore_pending() {
    let mut v = harvest_setup();
    let now = T0 + YEAR;
    ctx(&keeper(), now);
    v.harvest();
    ctx_callback(now, PromiseResult::Failed);
    v.on_fee_minted(U128(usd(10)));
    ctx_callback(now, PromiseResult::Failed);
    let _ = v.on_pot_minted(U128(117_500_000));
    assert_eq!((v.pending_fee, v.pending_pot), (usd(10), 117_500_000));
    assert_eq!(v.payouts_in_flight, 0);
    // A failed transfer call keeps the tokens as held pot.
    ctx(&keeper(), now);
    v.flush_payouts();
    ctx_callback(now, ok());
    let _ = v.on_pot_minted(U128(117_500_000));
    ctx_callback(now, PromiseResult::Failed);
    v.on_pot_sent(U128(117_500_000));
    assert_eq!(
        event("vault_payout_failed").unwrap()["data"]["kind"],
        "pot_transfer"
    );
    assert_eq!(v.pot_held, 117_500_000);
}

#[test]
fn harvest_with_nothing_pending_changes_nothing() {
    let mut v = setup();
    ctx(&keeper(), T0 + DAY);
    v.harvest();
    assert!(get_created_receipts().is_empty());
    assert!(events().is_empty());
    assert_eq!(v.payouts_in_flight, 0);
    let mut low_gas = builder(&keeper(), T0, NearToken::from_yoctonear(0));
    low_gas.prepaid_gas(Gas::from_tgas(149));
    testing_env!(low_gas.build());
    assert!(fails(|| v.harvest()));
}

#[test]
fn keeper_clears_stale_payouts() {
    let mut v = harvest_setup();
    ctx(&keeper(), T0 + YEAR);
    v.harvest();
    ctx(&keeper(), T0 + YEAR + 599_999);
    assert!(fails(|| v.clear_stale_payouts()));
    ctx(&keeper(), T0 + YEAR + 600_000);
    v.clear_stale_payouts();
    assert_eq!(v.payouts_in_flight, 0);
    assert!(fails(|| v.clear_stale_payouts()), "nothing in flight");
}

#[test]
fn claim_backer_yield() {
    let mut v = setup();
    register(&mut v, &backer(), T0);
    deposit(&mut v, &backer(), Pool::Backer, usd(2_000), T0);
    let now = T0 + YEAR;
    ctx(&backer(), now);
    assert!(fails(|| v.claim_yield()), "needs 1 yocto");
    ctx_deposit(&backer(), now, NearToken::from_yoctonear(1));
    let _ = v.claim_yield();
    let mint = calls().into_iter().find(|c| c.1 == "mint").unwrap();
    assert_eq!(mint.2["account_id"], backer().as_str());
    assert_eq!(mint.2["amount"], usd(45).to_string());
    assert_eq!(v.claimable_yield_of(backer()), U128(0));
    ctx_callback(now, ok());
    v.on_claimed(backer(), U128(usd(45)));
    assert_eq!(
        event("vault_yield_claimed").unwrap()["data"]["amount"],
        usd(45).to_string()
    );
    assert_eq!(
        v.role_of(backer()),
        Some(Pool::Backer),
        "principal is still there"
    );
    ctx_deposit(&backer(), now, NearToken::from_yoctonear(1));
    assert!(fails(|| v.claim_yield()), "nothing owed");

    // A failed mint restores the owed amount.
    ctx_deposit(&backer(), now + YEAR, NearToken::from_yoctonear(1));
    let _ = v.claim_yield();
    ctx_callback(now + YEAR, PromiseResult::Failed);
    v.on_claimed(backer(), U128(usd(45)));
    assert!(event("vault_claim_failed").is_some());
    assert_eq!(v.claimable_yield_of(backer()), U128(usd(45)));
}

#[test]
fn backer_exit_after_withdraw_and_claim() {
    let mut v = setup();
    register(&mut v, &backer(), T0);
    deposit(&mut v, &backer(), Pool::Backer, usd(2_000), T0);
    withdraw_ok(&mut v, &backer(), Pool::Backer, usd(2_000), T0 + YEAR);
    assert_eq!(
        v.role_of(backer()),
        Some(Pool::Backer),
        "owed yield keeps the role"
    );
    ctx_deposit(&backer(), T0 + YEAR + 1, NearToken::from_yoctonear(1));
    let _ = v.claim_yield();
    ctx_callback(T0 + YEAR + 1, ok());
    v.on_claimed(backer(), U128(usd(45)));
    assert!(event("vault_role_released").is_some());
    assert_eq!(v.role_of(backer()), None);
}

#[test]
fn mul_div_is_exact() {
    assert_eq!(mul_div(u128::MAX, u128::MAX, u128::MAX), u128::MAX);
    assert_eq!(mul_div(u128::MAX, 2, 4), u128::MAX / 2);
    assert_eq!(
        mul_div(10u128.pow(30), 10u128.pow(30), 10u128.pow(24)),
        10u128.pow(36)
    );
    assert_eq!(mul_div(7, 3, 2), 10);
    assert!(fails(|| mul_div(u128::MAX, 2, 1)));
}

#[test]
fn extreme_demo_rate_does_not_overflow() {
    let mut v = setup();
    register(&mut v, &fighter(), T0);
    deposit(&mut v, &fighter(), Pool::Fighter, usd(1_000_000_000), T0);
    ctx(&owner(), T0);
    v.set_apy_bps(5_000);
    ctx(&operator(), T0);
    v.set_time_multiplier(1_000_000);
    let t = totals(&v, T0 + 10 * YEAR);
    assert!(t.pending_pot.0 > 0);
}
