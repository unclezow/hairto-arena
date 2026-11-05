//! Deposits arrive through NEP-141 `ft_transfer_call` on the USDC token with `msg = {"pool":"Fighter"|"Backer"}`.
//! Every invalid deposit is refunded with a reason; nothing is ever stuck.

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::U128;
use near_sdk::serde_json;
use near_sdk::{env, near, require, AccountId, PromiseOrValue};

use crate::events::VaultEvent;
use crate::pool::Pool;
use crate::{Vault, VaultExt};

#[near(serializers = [json])]
struct DepositMsg {
    pool: Pool,
}

#[near]
impl FungibleTokenReceiver for Vault {
    /// Only the configured token may call this. Returns the unused amount: everything for a rejected deposit, 0 for
    /// an accepted one.
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            env::predecessor_account_id() == self.token_id,
            "only the USDC token"
        );
        match self.deposit(&sender_id, amount.0, &msg) {
            Ok(()) => PromiseOrValue::Value(U128(0)),
            Err(reason) => {
                VaultEvent::VaultDepositRejected {
                    account_id: sender_id,
                    amount,
                    reason: reason.to_string(),
                }
                .emit();
                PromiseOrValue::Value(amount)
            }
        }
    }
}

impl Vault {
    fn deposit(
        &mut self,
        sender_id: &AccountId,
        amount: u128,
        msg: &str,
    ) -> Result<(), &'static str> {
        let Some(mut account) = self.accounts.get(sender_id).cloned() else {
            return Err("not_registered");
        };
        if self.paused {
            return Err("paused");
        }
        let pool = serde_json::from_str::<DepositMsg>(msg)
            .map_err(|_| "bad_msg")?
            .pool;
        if account.role.is_some_and(|role| role != pool) {
            return Err("role_conflict");
        }
        let current = if account.role == Some(pool) {
            account.principal
        } else {
            0
        };
        if current + amount < self.pool(pool).config.min_deposit.0 {
            return Err("below_minimum");
        }

        self.accrue_pool(pool);
        if account.role.is_none() {
            // A fresh role starts at the current accumulator, so it earns nothing from before.
            account.role = Some(pool);
            account.owner_paid = self.pool(pool).acc_owner_per_unit;
        } else {
            self.settle(&mut account, pool);
        }
        self.change_principal(&mut account, pool, amount, 0);
        let principal = account.principal;
        self.accounts.insert(sender_id.clone(), account);
        if pool == Pool::Backer {
            self.write_checkpoint(sender_id, principal);
        }
        VaultEvent::VaultDeposited {
            account_id: sender_id.clone(),
            pool,
            amount: U128(amount),
            principal: U128(principal),
        }
        .emit();
        Ok(())
    }
}
