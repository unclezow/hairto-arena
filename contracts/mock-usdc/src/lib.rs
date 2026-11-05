//! "USD Coin (Mock)": a testnet-only NEP-141 token with no value.
//!
//! Transfers, storage management and metadata come from `near-contract-standards`, wired by hand as in the official
//! fungible token example. On top of that: a public faucet (1 000 USDC per account per hour by default) and a minter
//! role the vault uses for simulated yield.

use near_contract_standards::fungible_token::events::FtBurn;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::collections::LazyOption;
use near_sdk::json_types::U128;
use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{
    env, log, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue,
};

pub mod events;
pub mod faucet;
pub mod minters;

#[cfg(test)]
mod tests;

/// 1 USDC in base units (6 decimals).
pub const ONE_USDC: u128 = 1_000_000;
pub const DECIMALS: u8 = 6;
pub const DEFAULT_FAUCET_AMOUNT: u128 = 1_000 * ONE_USDC;
pub const DEFAULT_FAUCET_COOLDOWN_MS: u64 = 3_600_000;
pub const MIN_FAUCET_AMOUNT: u128 = ONE_USDC;
pub const MAX_FAUCET_AMOUNT: u128 = 100_000 * ONE_USDC;
pub const MIN_FAUCET_COOLDOWN_MS: u64 = 60_000;
pub const MAX_FAUCET_COOLDOWN_MS: u64 = 86_400_000;

const ICON: &str = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%232775ca'/%3E%3Ctext x='16' y='22' font-family='Arial,sans-serif' font-size='18' font-weight='700' fill='%23fff' text-anchor='middle'%3E$%3C/text%3E%3C/svg%3E";

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Token,
    Metadata,
    Minters,
    LastClaim,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockUsdc {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
    owner_id: AccountId,
    minters: IterableSet<AccountId>,
    faucet_amount: u128,
    faucet_cooldown_ms: u64,
    /// Last faucet claim per account, in ms.
    last_claim: LookupMap<AccountId, u64>,
}

pub fn metadata() -> FungibleTokenMetadata {
    FungibleTokenMetadata {
        spec: FT_METADATA_SPEC.to_string(),
        name: "USD Coin (Mock)".to_string(),
        symbol: "USDC".to_string(),
        icon: Some(ICON.to_string()),
        reference: None,
        reference_hash: None,
        decimals: DECIMALS,
    }
}

#[near]
impl MockUsdc {
    /// Total supply starts at 0. Deploy and call this in one transaction.
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        let metadata = metadata();
        metadata.assert_valid();
        Self {
            token: FungibleToken::new(StorageKey::Token),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
            owner_id,
            minters: IterableSet::new(StorageKey::Minters),
            faucet_amount: DEFAULT_FAUCET_AMOUNT,
            faucet_cooldown_ms: DEFAULT_FAUCET_COOLDOWN_MS,
            last_claim: LookupMap::new(StorageKey::LastClaim),
        }
    }

    pub fn owner_id(&self) -> AccountId {
        self.owner_id.clone()
    }

    /// Owner: hands ownership to another account.
    pub fn transfer_ownership(&mut self, new_owner_id: AccountId) {
        self.assert_owner();
        self.owner_id = new_owner_id;
    }
}

impl MockUsdc {
    pub(crate) fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "only the owner"
        );
    }

    pub(crate) fn is_registered(&self, account_id: &AccountId) -> bool {
        self.token.accounts.contains_key(account_id)
    }
}

// ---------------------------------------------------------------- NEP-141 (standard implementation)

#[near]
impl FungibleTokenCore for MockUsdc {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for MockUsdc {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used_amount, burned_amount) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned_amount > 0 {
            log!("Account @{} burned {}", sender_id, burned_amount);
        }
        used_amount.into()
    }
}

// ---------------------------------------------------------------- NEP-145 (standard implementation)

#[near]
impl StorageManagement for MockUsdc {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        match self.token.internal_storage_unregister(force) {
            Some((account_id, balance)) => {
                if balance > 0 {
                    FtBurn {
                        owner_id: &account_id,
                        amount: U128(balance),
                        memo: Some("account closed"),
                    }
                    .emit();
                }
                true
            }
            None => false,
        }
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for MockUsdc {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().unwrap_or_else(|| env::abort())
    }
}
