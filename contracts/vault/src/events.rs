//! NEP-297 events: `EVENT_JSON:{"standard":"hairto","version":"1.0.0","event":"<name>","data":{...}}`.

use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

use crate::pool::{Accrued, Pool, PoolConfig};

#[near(event_json(standard = "hairto"))]
pub enum VaultEvent {
    #[event_version("1.0.0")]
    VaultRegistered { account_id: AccountId },
    #[event_version("1.0.0")]
    VaultDeposited {
        account_id: AccountId,
        pool: Pool,
        amount: U128,
        principal: U128,
    },
    #[event_version("1.0.0")]
    VaultDepositRejected {
        account_id: AccountId,
        amount: U128,
        reason: String,
    },
    #[event_version("1.0.0")]
    VaultWithdrawn {
        account_id: AccountId,
        pool: Pool,
        amount: U128,
        principal: U128,
    },
    #[event_version("1.0.0")]
    VaultWithdrawFailed {
        account_id: AccountId,
        pool: Pool,
        amount: U128,
    },
    #[event_version("1.0.0")]
    VaultYieldClaimed { account_id: AccountId, amount: U128 },
    #[event_version("1.0.0")]
    VaultClaimFailed { account_id: AccountId, amount: U128 },
    /// Per-pool fee, pot and owner yield accrued since the previous harvest, and what is being paid out now.
    #[event_version("1.0.0")]
    VaultHarvested {
        fighter: Accrued,
        backer: Accrued,
        fee: U128,
        pot: U128,
    },
    #[event_version("1.0.0")]
    VaultFeePaid {
        treasury_id: AccountId,
        amount: U128,
    },
    #[event_version("1.0.0")]
    VaultPotFunded { arena_id: AccountId, amount: U128 },
    /// `kind`: `fee_mint`, `pot_mint`, `pot_transfer`, or `pot_returned`.
    #[event_version("1.0.0")]
    VaultPayoutFailed { kind: String, amount: U128 },
    #[event_version("1.0.0")]
    VaultRoleReleased { account_id: AccountId, pool: Pool },
    #[event_version("1.0.0")]
    VaultConfigUpdated { pool: Pool, config: PoolConfig },
    #[event_version("1.0.0")]
    VaultYieldRateUpdated { apy_bps: u16, time_multiplier: u32 },
    #[event_version("1.0.0")]
    VaultPaused { by: AccountId },
    #[event_version("1.0.0")]
    VaultUnpaused { by: AccountId },
}
