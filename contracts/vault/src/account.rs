//! Account registration (fixed NEAR storage fee), one account one role, and eligibility views.

use near_contract_standards::storage_management::StorageBalance;
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, NearToken, Promise};

use crate::events::VaultEvent;
use crate::pool::Pool;
use crate::{Vault, VaultExt};

/// Fixed NEAR fee to register an account, refunded on full exit.
pub const ACCOUNT_STORAGE_FEE: NearToken = NearToken::from_millinear(10);

#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Account {
    /// Assigned on the first accepted deposit, released on full exit.
    pub role: Option<Pool>,
    pub principal: u128,
    /// Pool `acc_owner_per_unit` at the last settlement.
    pub owner_paid: u128,
    /// Owner yield settled but not yet claimed.
    pub owed: u128,
    /// Withdrawals and claims waiting for their callback. The account is never released while one is in flight.
    pub in_flight: u8,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AccountView {
    pub role: Option<Pool>,
    pub principal: U128,
    /// Includes accrual up to now.
    pub claimable_yield: U128,
}

#[near]
impl Vault {
    /// Registers `account_id` (default: caller) for a fixed 0.01 NEAR. The excess, or everything if the account is
    /// already registered, is refunded to the caller.
    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>) -> StorageBalance {
        let account_id = account_id.unwrap_or_else(env::predecessor_account_id);
        let deposit = env::attached_deposit();
        let refund = if self.accounts.contains_key(&account_id) {
            deposit
        } else {
            require!(
                deposit >= ACCOUNT_STORAGE_FEE,
                "attach 0.01 NEAR to register"
            );
            self.accounts.insert(account_id.clone(), Account::default());
            VaultEvent::VaultRegistered {
                account_id: account_id.clone(),
            }
            .emit();
            deposit.saturating_sub(ACCOUNT_STORAGE_FEE)
        };
        if !refund.is_zero() {
            Promise::new(env::predecessor_account_id())
                .transfer(refund)
                .detach();
        }
        Self::registered_balance()
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.accounts
            .contains_key(&account_id)
            .then(Self::registered_balance)
    }

    pub fn role_of(&self, account_id: AccountId) -> Option<Pool> {
        self.accounts.get(&account_id).and_then(|a| a.role)
    }

    /// True for a Fighter whose principal is at least the Fighter minimum. Called by `arena` before every duel.
    pub fn can_play(&self, account_id: AccountId) -> bool {
        self.meets_minimum(&account_id, Pool::Fighter)
    }

    /// True for a Backer whose principal is at least the Backer minimum.
    pub fn can_pick(&self, account_id: AccountId) -> bool {
        self.meets_minimum(&account_id, Pool::Backer)
    }

    pub fn principal_of(&self, pool: Pool, account_id: AccountId) -> U128 {
        U128(
            self.accounts
                .get(&account_id)
                .filter(|a| a.role == Some(pool))
                .map(|a| a.principal)
                .unwrap_or(0),
        )
    }

    pub fn get_account(&self, account_id: AccountId) -> Option<AccountView> {
        self.accounts.get(&account_id).map(|a| AccountView {
            role: a.role,
            principal: U128(a.principal),
            claimable_yield: U128(self.live_owed(a)),
        })
    }
}

impl Vault {
    fn registered_balance() -> StorageBalance {
        StorageBalance {
            total: ACCOUNT_STORAGE_FEE,
            available: NearToken::from_yoctonear(0),
        }
    }

    fn meets_minimum(&self, account_id: &AccountId, pool: Pool) -> bool {
        self.accounts.get(account_id).is_some_and(|a| {
            a.role == Some(pool) && a.principal >= self.pool(pool).config.min_deposit.0
        })
    }

    /// The account a cash-out callback settles. Release waits for callbacks, so the record exists; the fallback
    /// only guards against losing principal if it somehow does not.
    pub(crate) fn account_for_callback(
        &self,
        account_id: &AccountId,
        pool: Option<Pool>,
    ) -> Account {
        self.accounts
            .get(account_id)
            .cloned()
            .unwrap_or_else(|| Account {
                role: pool,
                owner_paid: pool.map(|p| self.pool(p).acc_owner_per_unit).unwrap_or(0),
                in_flight: 1,
                ..Account::default()
            })
    }

    pub(crate) fn account_or_panic(&self, account_id: &AccountId) -> Account {
        self.accounts
            .get(account_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("account not registered"))
    }

    /// Removes a fully exited account, refunds its storage fee and emits `vault_role_released`. Returns whether it
    /// was released.
    pub(crate) fn release_if_exited(&mut self, account_id: &AccountId) -> bool {
        let exited = self.accounts.get(account_id).is_some_and(|a| {
            a.role.is_some() && a.principal == 0 && a.owed == 0 && a.in_flight == 0
        });
        if !exited {
            return false;
        }
        let role = self.accounts.remove(account_id).and_then(|a| a.role);
        Promise::new(account_id.clone())
            .transfer(ACCOUNT_STORAGE_FEE)
            .detach();
        if let Some(pool) = role {
            VaultEvent::VaultRoleReleased {
                account_id: account_id.clone(),
                pool,
            }
            .emit();
        }
        true
    }
}
