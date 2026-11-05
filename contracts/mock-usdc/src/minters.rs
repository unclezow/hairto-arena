//! Minter role: contracts the owner allows to mint, such as the vault for simulated yield.

use near_contract_standards::fungible_token::events::FtMint;
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId};

use crate::events::UsdcEvent;
use crate::{MockUsdc, MockUsdcExt};

#[near]
impl MockUsdc {
    /// Minter: mints `amount` to a registered account.
    pub fn mint(&mut self, account_id: AccountId, amount: U128, memo: Option<String>) {
        require!(
            self.minters.contains(&env::predecessor_account_id()),
            "only a minter"
        );
        require!(amount.0 > 0, "amount must be positive");
        require!(
            self.is_registered(&account_id),
            "receiver is not registered"
        );
        self.token.internal_deposit(&account_id, amount.0);
        FtMint {
            owner_id: &account_id,
            amount,
            memo: memo.as_deref(),
        }
        .emit();
    }

    pub fn add_minter(&mut self, account_id: AccountId) {
        self.assert_owner();
        if self.minters.insert(account_id.clone()) {
            UsdcEvent::MinterAdded { account_id }.emit();
        }
    }

    pub fn remove_minter(&mut self, account_id: AccountId) {
        self.assert_owner();
        if self.minters.remove(&account_id) {
            UsdcEvent::MinterRemoved { account_id }.emit();
        }
    }

    pub fn is_minter(&self, account_id: AccountId) -> bool {
        self.minters.contains(&account_id)
    }

    pub fn get_minters(&self) -> Vec<AccountId> {
        self.minters.iter().cloned().collect()
    }
}
