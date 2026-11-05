//! The shop: purchases paid in USDC (mock) through `ft_on_transfer`, free grants by minters, and the sweep of
//! purchase proceeds to the treasury.

use near_sdk::json_types::U128;
use near_sdk::serde_json;
use near_sdk::{
    env, ext_contract, is_promise_success, near, require, AccountId, Gas, NearToken, Promise,
    PromiseOrValue,
};

use crate::catalog::parse_token_id;
use crate::events::ShopEvent;
use crate::mt_core::MintError;
use crate::{Characters, CharactersExt, Role};

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

#[near(serializers = [json])]
struct BuyMsg {
    buy: String,
}

#[near]
impl Characters {
    /// NEP-141 receiver for purchases: `ft_transfer_call(characters, amount, {"buy":"<id>"})` on the configured USDC
    /// token. Mints one copy to the sender and returns `amount - price` as unused, or returns everything with
    /// `purchase_rejected`. Calls from any other token fail, so that token refunds its sender.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            env::predecessor_account_id() == self.token_id,
            "only the USDC token"
        );
        match self.purchase(&sender_id, amount.0, &msg) {
            Ok(price) => PromiseOrValue::Value(U128(amount.0 - price)),
            Err(reason) => {
                ShopEvent::PurchaseRejected {
                    buyer: sender_id,
                    amount,
                    reason: reason.to_string(),
                }
                .emit();
                PromiseOrValue::Value(amount)
            }
        }
    }

    /// Minter: mints one free copy of a listed character to `to`, subject to supply and the one-copy rule.
    pub fn grant(&mut self, to: AccountId, token_id: String) {
        self.assert_role(Role::Minter);
        require!(!self.paused, "shop paused");
        let id = self.listed_id_or_panic(&token_id);
        if let Err(e) = self.check_mint(id, &to) {
            env::panic_str(e.reason());
        }
        self.mint_one(id, &to, "grant");
        ShopEvent::CharacterGranted { to, token_id }.emit();
    }
}

impl Characters {
    /// Returns the price paid, or the rejection reason.
    fn purchase(
        &mut self,
        buyer: &AccountId,
        amount: u128,
        msg: &str,
    ) -> Result<u128, &'static str> {
        if self.paused {
            return Err("paused");
        }
        let token_id = serde_json::from_str::<BuyMsg>(msg)
            .map_err(|_| "bad_msg")?
            .buy;
        let id = parse_token_id(&token_id).ok_or("not_for_sale")?;
        self.check_mint(id, buyer).map_err(MintError::reason)?;
        let price = self
            .listing(id)
            .map(|l| l.price)
            .unwrap_or_else(|| env::abort());
        if amount < price {
            return Err("underpaid");
        }
        self.mint_one(id, buyer, "purchase");
        self.treasury_balance += price;
        ShopEvent::CharacterPurchased {
            buyer: buyer.clone(),
            token_id,
            price: U128(price),
        }
        .emit();
        Ok(price)
    }
}
