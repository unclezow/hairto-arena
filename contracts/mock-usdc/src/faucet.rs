//! Public faucet: one claim per account per cooldown, registering the caller's token storage on the first claim.

use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::storage_management::StorageManagement;
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, NearToken, Promise};

use crate::events::UsdcEvent;
use crate::{
    MockUsdc, MockUsdcExt, MAX_FAUCET_AMOUNT, MAX_FAUCET_COOLDOWN_MS, MIN_FAUCET_AMOUNT,
    MIN_FAUCET_COOLDOWN_MS,
};

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FaucetInfo {
    pub faucet_amount: U128,
    pub faucet_cooldown_ms: u64,
    /// When the account can claim next, in ms. 0 if it never claimed.
    pub next_claim_ms: u64,
}

#[near]
impl MockUsdc {
    /// Mints `faucet_amount` to the caller once per cooldown. An unregistered caller must attach at least the storage
    /// minimum and is registered; any deposit above what registration needs is refunded.
    #[payable]
    pub fn faucet(&mut self) -> U128 {
        let caller = env::predecessor_account_id();
        let deposit = env::attached_deposit();
        let now = env::block_timestamp_ms();
        if let Some(last) = self.last_claim.get(&caller) {
            require!(
                now >= last + self.faucet_cooldown_ms,
                "faucet cooldown not over"
            );
        }

        let mut refund = deposit;
        if !self.is_registered(&caller) {
            let min = self.token.storage_balance_bounds().min;
            require!(
                deposit >= min,
                "attach the storage minimum to register on the first claim"
            );
            self.token.internal_register_account(&caller);
            refund = deposit.saturating_sub(min);
        }

        let amount = self.faucet_amount;
        self.token.internal_deposit(&caller, amount);
        self.last_claim.insert(caller.clone(), now);
        FtMint {
            owner_id: &caller,
            amount: U128(amount),
            memo: Some("faucet"),
        }
        .emit();
        UsdcEvent::FaucetClaimed {
            account_id: caller.clone(),
            amount: U128(amount),
            next_claim_ms: now + self.faucet_cooldown_ms,
        }
        .emit();
        if refund > NearToken::from_yoctonear(0) {
            Promise::new(caller).transfer(refund).detach();
        }
        U128(amount)
    }

    pub fn faucet_info(&self, account_id: AccountId) -> FaucetInfo {
        FaucetInfo {
            faucet_amount: U128(self.faucet_amount),
            faucet_cooldown_ms: self.faucet_cooldown_ms,
            next_claim_ms: self
                .last_claim
                .get(&account_id)
                .map(|last| last + self.faucet_cooldown_ms)
                .unwrap_or(0),
        }
    }

    /// Owner: amount 1–100 000 USDC, cooldown 1 min–24 h. Omitted values stay as they are.
    pub fn set_faucet_config(
        &mut self,
        faucet_amount: Option<U128>,
        faucet_cooldown_ms: Option<u64>,
    ) {
        self.assert_owner();
        if let Some(U128(amount)) = faucet_amount {
            require!(
                (MIN_FAUCET_AMOUNT..=MAX_FAUCET_AMOUNT).contains(&amount),
                "faucet amount out of range"
            );
            self.faucet_amount = amount;
        }
        if let Some(cooldown) = faucet_cooldown_ms {
            require!(
                (MIN_FAUCET_COOLDOWN_MS..=MAX_FAUCET_COOLDOWN_MS).contains(&cooldown),
                "faucet cooldown out of range"
            );
            self.faucet_cooldown_ms = cooldown;
        }
        UsdcEvent::FaucetConfigUpdated {
            faucet_amount: U128(self.faucet_amount),
            faucet_cooldown_ms: self.faucet_cooldown_ms,
        }
        .emit();
    }
}
