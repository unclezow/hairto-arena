//! `hairto` NEP-297 events of the characters contract. Mints and transfers also log the standard `nep245` events.

use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

use crate::Role;

#[near(event_json(standard = "hairto"))]
pub enum ShopEvent {
    #[event_version("1.0.0")]
    CharacterListed {
        token_id: String,
        name: String,
        price: U128,
        max_supply: u64,
    },
    #[event_version("1.0.0")]
    CharacterUpdated {
        token_id: String,
        name: String,
        price: U128,
        max_supply: u64,
        active: bool,
    },
    #[event_version("1.0.0")]
    CharacterPurchased {
        buyer: AccountId,
        token_id: String,
        price: U128,
    },
    /// `reason`: `paused`, `bad_msg`, `not_for_sale`, `sold_out`, `already_owned`, or `underpaid`.
    #[event_version("1.0.0")]
    PurchaseRejected {
        buyer: AccountId,
        amount: U128,
        reason: String,
    },
    #[event_version("1.0.0")]
    CharacterGranted { to: AccountId, token_id: String },
    /// `token_id` is `"0"` when the account is back on the default character.
    #[event_version("1.0.0")]
    CharacterEquipped {
        account_id: AccountId,
        token_id: String,
    },
    #[event_version("1.0.0")]
    TreasurySwept {
        treasury_id: AccountId,
        amount: U128,
    },
    #[event_version("1.0.0")]
    TreasurySweepFailed {
        treasury_id: AccountId,
        amount: U128,
    },
    #[event_version("1.0.0")]
    ShopPaused { by: AccountId },
    #[event_version("1.0.0")]
    ShopUnpaused { by: AccountId },
    /// `role` is `None` for an ownership transfer.
    #[event_version("1.0.0")]
    RoleChanged {
        role: Option<Role>,
        account_id: AccountId,
        granted: bool,
    },
}

/// One `mt_mint` log entry (NEP-245).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MtMintLog {
    pub owner_id: AccountId,
    pub token_ids: Vec<String>,
    pub amounts: Vec<U128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memo: Option<String>,
}

/// One `mt_transfer` log entry (NEP-245).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MtTransferLog {
    pub old_owner_id: AccountId,
    pub new_owner_id: AccountId,
    pub token_ids: Vec<String>,
    pub amounts: Vec<U128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memo: Option<String>,
}

/// Standard NEP-245 events: `EVENT_JSON:{"standard":"nep245","version":"1.0.0","event":"mt_mint","data":[...]}`.
#[near(event_json(standard = "nep245"))]
pub enum MtEvent {
    #[event_version("1.0.0")]
    MtMint(Vec<MtMintLog>),
    #[event_version("1.0.0")]
    MtTransfer(Vec<MtTransferLog>),
}
