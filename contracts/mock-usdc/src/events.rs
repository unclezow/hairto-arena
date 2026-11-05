//! `hairto` NEP-297 events. Mints, transfers and burns use the standard `nep141` events from the library.

use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

#[near(event_json(standard = "hairto"))]
pub enum UsdcEvent {
    #[event_version("1.0.0")]
    FaucetClaimed {
        account_id: AccountId,
        amount: U128,
        next_claim_ms: u64,
    },
    #[event_version("1.0.0")]
    MinterAdded { account_id: AccountId },
    #[event_version("1.0.0")]
    MinterRemoved { account_id: AccountId },
    #[event_version("1.0.0")]
    FaucetConfigUpdated {
        faucet_amount: U128,
        faucet_cooldown_ms: u64,
    },
}
