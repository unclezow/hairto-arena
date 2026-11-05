//! Hairto Arena vault.
//!
//! Two pools of mock USDC principal (Fighter and Backer). The vault holds every unit of principal and pays it back on
//! request. Yield is simulated: it accrues continuously at a fixed rate, is split into a treasury fee, a Season Pot
//! share and (for Backers) an owner share, and is minted from the USDC token when it is paid out.

use near_sdk::json_types::U128;
use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{env, near, AccountId, BorshStorageKey, PanicOnDefault};

pub mod account;
pub mod accrual;
pub mod admin;
pub mod deposit;
pub mod events;
pub mod ext;
pub mod payouts;
pub mod pool;
pub mod twab;
pub mod withdraw;

#[cfg(test)]
mod tests;

use account::Account;
use pool::{PoolConfig, PoolState};
use twab::Checkpoint;

/// 1 USDC in base units (6 decimals).
pub const ONE_USDC: u128 = 1_000_000;
pub const DEFAULT_APY_BPS: u16 = 500;
pub const MAX_APY_BPS: u16 = 5_000;
pub const MAX_FEE_BPS: u16 = 2_000;
pub const MAX_OWNER_SHARE_BPS: u16 = 10_000;
pub const MAX_TIME_MULTIPLIER: u32 = 1_000_000;
/// The keeper may clear a payout flag older than this.
pub const PAYOUT_STALE_MS: u64 = 600_000;

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Guardians,
    Keepers,
    Operators,
    Accounts,
    Checkpoints,
    TwabLen,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    // ---- owner, roles and links ----
    owner_id: AccountId,
    guardians: IterableSet<AccountId>,
    keepers: IterableSet<AccountId>,
    operators: IterableSet<AccountId>,
    token_id: AccountId,
    arena_id: AccountId,
    treasury_id: AccountId,
    demo_mode: bool,
    paused: bool,

    // ---- yield ----
    apy_bps: u16,
    time_multiplier: u32,
    fighter: PoolState,
    backer: PoolState,
    /// Fee accrued but not yet minted to the treasury.
    pending_fee: u128,
    /// Pot share accrued but not yet minted.
    pending_pot: u128,
    /// Pot tokens held by the vault after the arena returned them or a transfer failed. Sent first next time.
    pot_held: u128,
    /// Payout chains still waiting for their callbacks, and when the latest one started.
    payouts_in_flight: u8,
    payouts_started_ms: u64,

    // ---- accounts ----
    accounts: LookupMap<AccountId, Account>,
    checkpoints: LookupMap<(AccountId, u32), Checkpoint>,
    twab_len: LookupMap<AccountId, u32>,
}

#[near]
impl Vault {
    /// Deploy and call this in one transaction. `token_id` and `demo_mode` can never change.
    #[init]
    pub fn new(
        owner_id: AccountId,
        token_id: AccountId,
        arena_id: AccountId,
        treasury_id: AccountId,
        demo_mode: bool,
    ) -> Self {
        let now = Self::now_ms();
        Self {
            owner_id,
            guardians: IterableSet::new(StorageKey::Guardians),
            keepers: IterableSet::new(StorageKey::Keepers),
            operators: IterableSet::new(StorageKey::Operators),
            token_id,
            arena_id,
            treasury_id,
            demo_mode,
            paused: false,
            apy_bps: DEFAULT_APY_BPS,
            time_multiplier: 1,
            fighter: PoolState::new(
                PoolConfig {
                    min_deposit: U128(10 * ONE_USDC),
                    fee_bps: 500,
                    owner_share_bps: 0,
                },
                now,
            ),
            backer: PoolState::new(
                PoolConfig {
                    min_deposit: U128(100 * ONE_USDC),
                    fee_bps: 1_000,
                    owner_share_bps: 5_000,
                },
                now,
            ),
            pending_fee: 0,
            pending_pot: 0,
            pot_held: 0,
            payouts_in_flight: 0,
            payouts_started_ms: 0,
            accounts: LookupMap::new(StorageKey::Accounts),
            checkpoints: LookupMap::new(StorageKey::Checkpoints),
            twab_len: LookupMap::new(StorageKey::TwabLen),
        }
    }
}

impl Vault {
    pub(crate) fn now_ms() -> u64 {
        env::block_timestamp_ms()
    }
}
