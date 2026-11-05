//! Treasury proceeds: purchase prices accrue in the contract and anyone can sweep them to the treasury in USDC.

use near_sdk::json_types::U128;
use near_sdk::{
    env, ext_contract, is_promise_success, near, require, AccountId, Gas, NearToken, Promise,
};

use crate::events::ShopEvent;
use crate::{Characters, CharactersExt};

pub const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(10);
pub const GAS_FOR_ON_SWEPT: Gas = Gas::from_tgas(10);
pub const MIN_GAS_FOR_SWEEP: Gas = Gas::from_tgas(30);

#[ext_contract(ext_usdc)]
pub trait Usdc {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near]
impl Characters {
    /// Anyone: sends the whole treasury balance to the treasury with USDC `ft_transfer`. A failed transfer (for
    /// example, the treasury is not registered with USDC) restores the balance.
    pub fn sweep_to_treasury(&mut self) -> Promise {
        require!(
            env::prepaid_gas() >= MIN_GAS_FOR_SWEEP,
            "attach at least 30 Tgas"
        );
        let amount = std::mem::take(&mut self.treasury_balance);
        require!(amount > 0, "nothing to sweep");
        let treasury_id = self.treasury_id.clone();
        ext_usdc::ext(self.token_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(
                treasury_id.clone(),
                U128(amount),
                Some("character sales".to_string()),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_ON_SWEPT)
                    .on_swept(treasury_id, U128(amount)),
            )
    }

    #[private]
    pub fn on_swept(&mut self, treasury_id: AccountId, amount: U128) {
        if is_promise_success() {
            ShopEvent::TreasurySwept {
                treasury_id,
                amount,
            }
            .emit();
        } else {
            self.treasury_balance += amount.0;
            ShopEvent::TreasurySweepFailed {
                treasury_id,
                amount,
            }
            .emit();
        }
    }
}
