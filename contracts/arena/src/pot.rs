//! Season Pot in USDC (mock): funded by the vault through NEP-141 `ft_transfer_call(arena, amount, "fund_pot")`.

use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, PromiseOrValue};

use crate::events::ArenaEvent;
use crate::types::SeasonId;
use crate::{Arena, ArenaExt};

#[near]
impl Arena {
    /// Owner, once: the USDC (mock) token that funds pots and pays claims.
    pub fn set_token_id(&mut self, token_id: AccountId) {
        self.assert_owner();
        require!(self.token_id.is_none(), "token id already set");
        self.token_id = Some(token_id);
    }

    /// NEP-141 receiver. Accepts only USDC from the vault with `msg = "fund_pot"`; credits the funding season and
    /// returns 0. Anything else returns the full amount, so the token refunds the sender.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        let reason = if self.token_id.is_none() {
            Some("token_not_set")
        } else if self.token_id.as_ref() != Some(&token) {
            Some("wrong_token")
        } else if sender_id != self.vault_id {
            Some("not_vault")
        } else if msg != "fund_pot" {
            Some("bad_msg")
        } else if amount.0 == 0 {
            Some("zero_amount")
        } else {
            None
        };
        if let Some(reason) = reason {
            ArenaEvent::PotFundingRejected {
                token_id: token,
                sender_id,
                amount,
                reason: reason.to_string(),
            }
            .emit();
            return PromiseOrValue::Value(amount);
        }
        let season = self.funding_season();
        let pot = self.credit_pot(season, amount.0);
        ArenaEvent::PotFunded {
            season,
            amount,
            pot: U128(pot),
        }
        .emit();
        PromiseOrValue::Value(U128(0))
    }

    /// The current season while it is Picking or Active, otherwise the next one (1 before the first season), so a
    /// closed pot never grows.
    pub fn funding_season(&self) -> SeasonId {
        let current = self.current_season;
        match self.phase_of(current) {
            Some(phase) if phase.is_open() => current,
            _ => current + 1,
        }
    }

    pub fn pot_of(&self, season: SeasonId) -> U128 {
        U128(self.pot_amount(season))
    }

    /// Sum of all pots; equals the arena's USDC balance whenever no claim transfer is in flight.
    pub fn total_pots(&self) -> U128 {
        U128(self.total_pots)
    }
}

impl Arena {
    /// Adds to a season's pot and the total; returns the new pot.
    pub(crate) fn credit_pot(&mut self, season: SeasonId, amount: u128) -> u128 {
        let pot = self.pot_amount(season) + amount;
        self.pot_of.insert(season, pot);
        self.total_pots += amount;
        pot
    }

    /// Removes from a season's pot and the total.
    pub(crate) fn debit_pot(&mut self, season: SeasonId, amount: u128) {
        let pot = self.pot_amount(season);
        require!(pot >= amount, "pot too small");
        self.pot_of.insert(season, pot - amount);
        self.total_pots -= amount;
    }
}
