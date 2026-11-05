//! Cash-outs: principal withdrawals (never blocked) and Backer yield claims (minted on claim). Both need exactly
//! 1 yoctoNEAR, so a function-call key cannot move money out.

use near_sdk::json_types::U128;
use near_sdk::{
    assert_one_yocto, env, is_promise_success, near, require, AccountId, NearToken, Promise,
};

use crate::events::VaultEvent;
use crate::ext::{
    ext_usdc, GAS_FOR_CALLBACK, GAS_FOR_FT_TRANSFER, GAS_FOR_MINT, MIN_GAS_FOR_CASH_OUT,
};
use crate::pool::Pool;
use crate::{Vault, VaultExt};

#[near]
impl Vault {
    /// Sends `amount` of the caller's principal back with `ft_transfer`. Works while paused and in every season
    /// phase. A failed transfer restores the principal.
    #[payable]
    pub fn withdraw(&mut self, pool: Pool, amount: U128) -> Promise {
        assert_one_yocto();
        require!(
            env::prepaid_gas() >= MIN_GAS_FOR_CASH_OUT,
            "attach at least 30 Tgas"
        );
        let caller = env::predecessor_account_id();
        let mut account = self.account_or_panic(&caller);
        require!(account.role == Some(pool), "no principal in this pool");
        require!(
            amount.0 > 0 && amount.0 <= account.principal,
            "invalid amount"
        );

        self.accrue_pool(pool);
        self.settle(&mut account, pool);
        self.change_principal(&mut account, pool, 0, amount.0);
        account.in_flight += 1;
        let principal = account.principal;
        self.accounts.insert(caller.clone(), account);
        if pool == Pool::Backer {
            self.write_checkpoint(&caller, principal);
        }

        ext_usdc::ext(self.token_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(caller.clone(), amount, Some("vault withdrawal".to_string()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_withdrawn(caller, pool, amount),
            )
    }

    #[private]
    pub fn on_withdrawn(&mut self, account_id: AccountId, pool: Pool, amount: U128) {
        let mut account = self.account_for_callback(&account_id, Some(pool));
        account.in_flight = account.in_flight.saturating_sub(1);
        if is_promise_success() {
            let principal = account.principal;
            self.accounts.insert(account_id.clone(), account);
            VaultEvent::VaultWithdrawn {
                account_id: account_id.clone(),
                pool,
                amount,
                principal: U128(principal),
            }
            .emit();
            self.release_if_exited(&account_id);
            return;
        }
        self.accrue_pool(pool);
        self.settle(&mut account, pool);
        self.change_principal(&mut account, pool, amount.0, 0);
        let principal = account.principal;
        self.accounts.insert(account_id.clone(), account);
        if pool == Pool::Backer {
            self.write_checkpoint(&account_id, principal);
        }
        VaultEvent::VaultWithdrawFailed {
            account_id,
            pool,
            amount,
        }
        .emit();
    }

    /// Backer: mints all owner yield owed to the caller. Fails when nothing is owed.
    #[payable]
    pub fn claim_yield(&mut self) -> Promise {
        assert_one_yocto();
        require!(
            env::prepaid_gas() >= MIN_GAS_FOR_CASH_OUT,
            "attach at least 30 Tgas"
        );
        let caller = env::predecessor_account_id();
        let mut account = self.account_or_panic(&caller);
        if let Some(pool) = account.role {
            self.accrue_pool(pool);
            self.settle(&mut account, pool);
        }
        let owed = account.owed;
        require!(owed > 0, "no yield to claim");
        account.owed = 0;
        account.in_flight += 1;
        self.accounts.insert(caller.clone(), account);

        ext_usdc::ext(self.token_id.clone())
            .with_static_gas(GAS_FOR_MINT)
            .mint(caller.clone(), U128(owed), Some("backer yield".to_string()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_claimed(caller, U128(owed)),
            )
    }

    #[private]
    pub fn on_claimed(&mut self, account_id: AccountId, amount: U128) {
        let mut account = self.account_for_callback(&account_id, None);
        account.in_flight = account.in_flight.saturating_sub(1);
        if is_promise_success() {
            self.accounts.insert(account_id.clone(), account);
            VaultEvent::VaultYieldClaimed {
                account_id: account_id.clone(),
                amount,
            }
            .emit();
            self.release_if_exited(&account_id);
            return;
        }
        account.owed += amount.0;
        self.accounts.insert(account_id.clone(), account);
        VaultEvent::VaultClaimFailed { account_id, amount }.emit();
    }

    /// Owner yield the account can claim now, including accrual up to the current block time.
    pub fn claimable_yield_of(&self, account_id: AccountId) -> U128 {
        U128(
            self.accounts
                .get(&account_id)
                .map(|a| self.live_owed(a))
                .unwrap_or(0),
        )
    }
}
