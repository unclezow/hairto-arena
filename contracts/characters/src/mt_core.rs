//! NEP-245 balances: helpers to read, move and mint copies. Every token id is a listed character (`"1"`, `"2"`, …).

use near_sdk::json_types::U128;
use near_sdk::{env, AccountId};

use crate::catalog::parse_token_id;
use crate::events::{MtEvent, MtMintLog};
use crate::{CharacterId, Characters};

/// Why a copy cannot be minted to an account.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MintError {
    NotForSale,
    SoldOut,
    AlreadyOwned,
}

impl MintError {
    pub fn reason(self) -> &'static str {
        match self {
            MintError::NotForSale => "not_for_sale",
            MintError::SoldOut => "sold_out",
            MintError::AlreadyOwned => "already_owned",
        }
    }
}

impl Characters {
    pub(crate) fn balance(&self, id: CharacterId, account_id: &AccountId) -> u128 {
        self.balances
            .get(&(id, account_id.clone()))
            .copied()
            .unwrap_or(0)
    }

    pub(crate) fn add_balance(&mut self, id: CharacterId, account_id: &AccountId, amount: u128) {
        let next = self.balance(id, account_id) + amount;
        self.balances.insert((id, account_id.clone()), next);
    }

    /// A listed id (never `0`), or a failure for anything else.
    pub(crate) fn listed_id_or_panic(&self, token_id: &str) -> CharacterId {
        parse_token_id(token_id)
            .filter(|id| self.listing(*id).is_some())
            .unwrap_or_else(|| env::panic_str("unknown token id"))
    }

    /// Checks the listing, the supply and the one-copy rule for minting `id` to `to`.
    pub(crate) fn check_mint(&self, id: CharacterId, to: &AccountId) -> Result<(), MintError> {
        let listing = self
            .listing(id)
            .filter(|l| l.active)
            .ok_or(MintError::NotForSale)?;
        if listing.max_supply > 0 && listing.minted >= listing.max_supply {
            return Err(MintError::SoldOut);
        }
        if self.balance(id, to) > 0 {
            return Err(MintError::AlreadyOwned);
        }
        Ok(())
    }

    /// Mints one copy of `id` to `to` (already checked) and logs `mt_mint`.
    pub(crate) fn mint_one(&mut self, id: CharacterId, to: &AccountId, memo: &str) {
        if let Some(listing) = self.listing_mut(id) {
            listing.minted += 1;
        }
        self.add_balance(id, to, 1);
        MtEvent::MtMint(vec![MtMintLog {
            owner_id: to.clone(),
            token_ids: vec![id.to_string()],
            amounts: vec![U128(1)],
            memo: Some(memo.to_string()),
        }])
        .emit();
    }
}
