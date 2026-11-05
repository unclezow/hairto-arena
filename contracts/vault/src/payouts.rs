//! Payouts of accrued yield: the fee is minted to the treasury, the pot share is minted to the vault and sent to the
//! arena with `ft_transfer_call(msg = "fund_pot")`. Every step has a callback; anything that fails is kept and
//! retried by the next `harvest` or `flush_payouts`.

use near_sdk::json_types::U128;
use near_sdk::serde_json;
use near_sdk::{env, is_promise_success, near, require, NearToken, Promise, PromiseOrValue};

use crate::admin::Role;
use crate::events::VaultEvent;
use crate::ext::{
    ext_usdc, GAS_FOR_CALLBACK, GAS_FOR_FT_TRANSFER_CALL, GAS_FOR_MINT, GAS_FOR_ON_POT_MINTED,
    MIN_GAS_FOR_PAYOUTS,
};
use crate::pool::Accrued;
use crate::{Vault, VaultExt, PAYOUT_STALE_MS};

#[near]
impl Vault {
    /// Anyone: accrues both pools and pays out the pending fee and pot. Does nothing when nothing is pending. Needs
    /// at least 150 Tgas; not while another payout is in flight.
    pub fn harvest(&mut self) {
        self.assert_can_pay_out();
        self.accrue_all();
        let fighter = std::mem::take(&mut self.fighter.since_harvest);
        let backer = std::mem::take(&mut self.backer.since_harvest);
        if self.pending_fee == 0 && self.pending_pot == 0 && self.pot_held == 0 {
            return;
        }
        if fighter != Accrued::default() || backer != Accrued::default() {
            VaultEvent::VaultHarvested {
                fighter,
                backer,
                fee: U128(self.pending_fee),
                pot: U128(self.pending_pot),
            }
            .emit();
        }
        self.start_payouts();
    }

    /// Anyone: retries pending and held payouts without accruing.
    pub fn flush_payouts(&mut self) {
        self.assert_can_pay_out();
        self.start_payouts();
    }

    /// Keeper: clears the payout flag when callbacks never ran (for example, gas exhaustion), 10 minutes after the
    /// last payout started.
    pub fn clear_stale_payouts(&mut self) {
        self.assert_role(Role::Keeper);
        require!(self.payouts_in_flight > 0, "no payout in flight");
        require!(
            Self::now_ms() >= self.payouts_started_ms + PAYOUT_STALE_MS,
            "payout not stale yet"
        );
        self.payouts_in_flight = 0;
    }

    #[private]
    pub fn on_fee_minted(&mut self, amount: U128) {
        self.payouts_in_flight = self.payouts_in_flight.saturating_sub(1);
        if is_promise_success() {
            VaultEvent::VaultFeePaid {
                treasury_id: self.treasury_id.clone(),
                amount,
            }
            .emit();
        } else {
            self.pending_fee += amount.0;
            Self::payout_failed("fee_mint", amount.0);
        }
    }

    /// The pot share is now vault-held USDC; send everything held to the arena.
    #[private]
    pub fn on_pot_minted(&mut self, amount: U128) -> PromiseOrValue<()> {
        if is_promise_success() {
            self.pot_held += amount.0;
            PromiseOrValue::Promise(self.send_pot())
        } else {
            self.payouts_in_flight = self.payouts_in_flight.saturating_sub(1);
            self.pending_pot += amount.0;
            Self::payout_failed("pot_mint", amount.0);
            PromiseOrValue::Value(())
        }
    }

    #[private]
    pub fn on_pot_sent(&mut self, amount: U128) {
        self.payouts_in_flight = self.payouts_in_flight.saturating_sub(1);
        match env::promise_result_checked(0, 64) {
            Ok(bytes) => {
                // `ft_transfer_call` resolves to the amount the arena kept. If it cannot be read, assume it was
                // kept, so the vault never counts tokens it no longer has.
                let used = serde_json::from_slice::<U128>(&bytes)
                    .map(|u| u.0.min(amount.0))
                    .unwrap_or(amount.0);
                if used > 0 {
                    VaultEvent::VaultPotFunded {
                        arena_id: self.arena_id.clone(),
                        amount: U128(used),
                    }
                    .emit();
                }
                let unused = amount.0 - used;
                if unused > 0 {
                    self.pot_held += unused;
                    Self::payout_failed("pot_returned", unused);
                }
            }
            Err(_) => {
                self.pot_held += amount.0;
                Self::payout_failed("pot_transfer", amount.0);
            }
        }
    }
}

impl Vault {
    fn assert_can_pay_out(&self) {
        require!(
            env::prepaid_gas() >= MIN_GAS_FOR_PAYOUTS,
            "attach at least 150 Tgas"
        );
        require!(self.payouts_in_flight == 0, "payouts in flight");
    }

    fn start_payouts(&mut self) {
        let fee = std::mem::take(&mut self.pending_fee);
        let pot = std::mem::take(&mut self.pending_pot);
        let me = env::current_account_id();
        if fee > 0 {
            self.payouts_in_flight += 1;
            ext_usdc::ext(self.token_id.clone())
                .with_static_gas(GAS_FOR_MINT)
                .mint(
                    self.treasury_id.clone(),
                    U128(fee),
                    Some("vault fee".into()),
                )
                .then(
                    Self::ext(me.clone())
                        .with_static_gas(GAS_FOR_CALLBACK)
                        .on_fee_minted(U128(fee)),
                )
                .detach();
        }
        if pot > 0 {
            self.payouts_in_flight += 1;
            ext_usdc::ext(self.token_id.clone())
                .with_static_gas(GAS_FOR_MINT)
                .mint(me.clone(), U128(pot), Some("season pot".into()))
                .then(
                    Self::ext(me)
                        .with_static_gas(GAS_FOR_ON_POT_MINTED)
                        .on_pot_minted(U128(pot)),
                )
                .detach();
        } else if self.pot_held > 0 {
            self.payouts_in_flight += 1;
            self.send_pot().detach();
        }
        if self.payouts_in_flight > 0 {
            self.payouts_started_ms = Self::now_ms();
        }
    }

    /// Sends all held pot tokens to the arena. The caller has counted this chain in `payouts_in_flight`.
    fn send_pot(&mut self) -> Promise {
        let amount = std::mem::take(&mut self.pot_held);
        ext_usdc::ext(self.token_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER_CALL)
            .ft_transfer_call(
                self.arena_id.clone(),
                U128(amount),
                Some("season pot".into()),
                "fund_pot".into(),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_pot_sent(U128(amount)),
            )
    }

    fn payout_failed(kind: &str, amount: u128) {
        VaultEvent::VaultPayoutFailed {
            kind: kind.to_string(),
            amount: U128(amount),
        }
        .emit();
    }
}
