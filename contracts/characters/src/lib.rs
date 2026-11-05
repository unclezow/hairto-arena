//! Hairto Arena characters: cosmetic NEP-245 multi-tokens, one token id per character kind, sold for USDC (mock).
//!
//! Id 0 is the free default character and is never minted. Owning or equipping a character never affects duels,
//! scores, eligibility or payouts; no other Hairto Arena contract reads this one.

use near_sdk::store::{IterableSet, LookupMap, Vector};

pub mod admin;
pub mod catalog;
pub mod events;
use near_sdk::{near, AccountId, BorshStorageKey, PanicOnDefault};

/// 1 USDC in base units (6 decimals).
pub const ONE_USDC: u128 = 1_000_000;
pub const MAX_NAME_LEN: usize = 32;

/// Character kind id; `0` is the free default.
pub type CharacterId = u32;

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Guardians,
    Minters,
    Listings,
    Balances,
    Equipped,
}

/// Roles the owner can grant. The owner holds none of them implicitly.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    /// Pauses and unpauses purchases and grants.
    Guardian,
    /// Grants free copies.
    Minter,
}

/// A listed character kind.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Listing {
    pub name: String,
    /// USDC base units; 0 is allowed.
    pub price: u128,
    /// 0 means unlimited.
    pub max_supply: u64,
    pub minted: u64,
    pub active: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Characters {
    owner_id: AccountId,
    guardians: IterableSet<AccountId>,
    minters: IterableSet<AccountId>,
    /// Stops purchases and grants only.
    paused: bool,
    /// USDC (mock) token that pays for purchases; fixed at init.
    token_id: AccountId,
    treasury_id: AccountId,
    /// Prepended to `<id>.json` in token metadata.
    base_uri: String,
    /// Purchase proceeds held for `sweep_to_treasury`.
    treasury_balance: u128,
    /// Character id `n` is stored at index `n - 1`.
    listings: Vector<Listing>,
    balances: LookupMap<(CharacterId, AccountId), u128>,
    /// Only non-zero ids are stored.
    equipped: LookupMap<AccountId, CharacterId>,
}

#[near]
impl Characters {
    /// Deploy and call this in one transaction. `token_id` can never change.
    #[init]
    pub fn new(
        owner_id: AccountId,
        token_id: AccountId,
        treasury_id: AccountId,
        base_uri: String,
    ) -> Self {
        Self {
            owner_id,
            guardians: IterableSet::new(StorageKey::Guardians),
            minters: IterableSet::new(StorageKey::Minters),
            paused: false,
            token_id,
            treasury_id,
            base_uri,
            treasury_balance: 0,
            listings: Vector::new(StorageKey::Listings),
            balances: LookupMap::new(StorageKey::Balances),
            equipped: LookupMap::new(StorageKey::Equipped),
        }
    }
}
