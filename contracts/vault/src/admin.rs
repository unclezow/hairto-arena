//! Owner, roles, pause of deposits, bounded configuration, yield rate, and read-only configuration views.

use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId};

use crate::events::VaultEvent;
use crate::pool::{Pool, PoolConfig};
use crate::{Vault, VaultExt, MAX_APY_BPS, MAX_FEE_BPS, MAX_OWNER_SHARE_BPS, MAX_TIME_MULTIPLIER};

/// Roles the owner can grant. The owner holds none of them implicitly.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    /// Pauses and unpauses deposits.
    Guardian,
    /// Clears a stale payout flag.
    Keeper,
    /// Sets the time multiplier in demo mode.
    Operator,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigView {
    pub owner_id: AccountId,
    pub token_id: AccountId,
    pub arena_id: AccountId,
    pub treasury_id: AccountId,
    pub demo_mode: bool,
    pub paused: bool,
    pub apy_bps: u16,
    pub time_multiplier: u32,
    pub fighter: PoolConfig,
    pub backer: PoolConfig,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RolesView {
    pub owner_id: AccountId,
    pub guardians: Vec<AccountId>,
    pub keepers: Vec<AccountId>,
    pub operators: Vec<AccountId>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TotalsView {
    pub fighter_principal: U128,
    pub backer_principal: U128,
    /// Fee and pot accrued up to now and not yet paid out.
    pub pending_fee: U128,
    pub pending_pot: U128,
    pub pot_held: U128,
    pub payouts_in_flight: u8,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct YieldRateView {
    pub apy_bps: u16,
    pub time_multiplier: u32,
}

#[near]
impl Vault {
    // ---------------------------------------------------------------- owner and roles

    pub fn transfer_ownership(&mut self, new_owner_id: AccountId) {
        self.assert_owner();
        self.owner_id = new_owner_id;
    }

    pub fn grant_role(&mut self, role: Role, account_id: AccountId) {
        self.assert_owner();
        self.role_set_mut(role).insert(account_id);
    }

    pub fn revoke_role(&mut self, role: Role, account_id: AccountId) {
        self.assert_owner();
        self.role_set_mut(role).remove(&account_id);
    }

    pub fn set_treasury(&mut self, treasury_id: AccountId) {
        self.assert_owner();
        self.treasury_id = treasury_id;
    }

    pub fn set_arena_id(&mut self, arena_id: AccountId) {
        self.assert_owner();
        self.arena_id = arena_id;
    }

    // ---------------------------------------------------------------- pause

    /// Guardian: refuses new deposits. Withdrawals, claims and payouts keep working.
    pub fn pause(&mut self) {
        self.assert_role(Role::Guardian);
        self.paused = true;
        VaultEvent::VaultPaused {
            by: env::predecessor_account_id(),
        }
        .emit();
    }

    pub fn unpause(&mut self) {
        self.assert_role(Role::Guardian);
        self.paused = false;
        VaultEvent::VaultUnpaused {
            by: env::predecessor_account_id(),
        }
        .emit();
    }

    // ---------------------------------------------------------------- configuration

    /// Owner: `min_deposit > 0`, `fee_bps <= 2 000`, `owner_share_bps <= 10 000`. Omitted values stay. Both pools are
    /// accrued first so past yield keeps the old split.
    pub fn set_pool_config(
        &mut self,
        pool: Pool,
        min_deposit: Option<U128>,
        fee_bps: Option<u16>,
        owner_share_bps: Option<u16>,
    ) {
        self.assert_owner();
        if let Some(min) = min_deposit {
            require!(min.0 > 0, "min deposit must be positive");
        }
        if let Some(fee) = fee_bps {
            require!(fee <= MAX_FEE_BPS, "fee above cap");
        }
        if let Some(share) = owner_share_bps {
            require!(share <= MAX_OWNER_SHARE_BPS, "owner share above cap");
        }
        self.accrue_all();
        let config = {
            let state = match pool {
                Pool::Fighter => &mut self.fighter,
                Pool::Backer => &mut self.backer,
            };
            if let Some(min) = min_deposit {
                state.config.min_deposit = min;
            }
            if let Some(fee) = fee_bps {
                state.config.fee_bps = fee;
            }
            if let Some(share) = owner_share_bps {
                state.config.owner_share_bps = share;
            }
            state.config.clone()
        };
        VaultEvent::VaultConfigUpdated { pool, config }.emit();
    }

    /// Owner: yearly rate 0–5 000 bps. Past yield is accrued at the old rate first.
    pub fn set_apy_bps(&mut self, apy_bps: u16) {
        self.assert_owner();
        require!(apy_bps <= MAX_APY_BPS, "apy above cap");
        self.accrue_all();
        self.apy_bps = apy_bps;
        self.emit_rate();
    }

    /// Operator, demo mode only: 1–1 000 000. Past yield is accrued at the old rate first.
    pub fn set_time_multiplier(&mut self, multiplier: u32) {
        self.assert_role(Role::Operator);
        require!(self.demo_mode, "time multiplier needs demo mode");
        require!(
            (1..=MAX_TIME_MULTIPLIER).contains(&multiplier),
            "multiplier out of range"
        );
        self.accrue_all();
        self.time_multiplier = multiplier;
        self.emit_rate();
    }

    // ---------------------------------------------------------------- views

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            owner_id: self.owner_id.clone(),
            token_id: self.token_id.clone(),
            arena_id: self.arena_id.clone(),
            treasury_id: self.treasury_id.clone(),
            demo_mode: self.demo_mode,
            paused: self.paused,
            apy_bps: self.apy_bps,
            time_multiplier: self.time_multiplier,
            fighter: self.fighter.config.clone(),
            backer: self.backer.config.clone(),
        }
    }

    pub fn get_roles(&self) -> RolesView {
        RolesView {
            owner_id: self.owner_id.clone(),
            guardians: self.guardians.iter().cloned().collect(),
            keepers: self.keepers.iter().cloned().collect(),
            operators: self.operators.iter().cloned().collect(),
        }
    }

    pub fn has_role(&self, role: Role, account_id: AccountId) -> bool {
        self.role_set(role).contains(&account_id)
    }

    /// Principal per pool and pending payouts accrued up to the current block time, without changing state.
    pub fn get_totals(&self) -> TotalsView {
        let (fee, pot) = self.live_pending();
        TotalsView {
            fighter_principal: U128(self.fighter.total_principal),
            backer_principal: U128(self.backer.total_principal),
            pending_fee: U128(fee),
            pending_pot: U128(pot),
            pot_held: U128(self.pot_held),
            payouts_in_flight: self.payouts_in_flight,
        }
    }

    pub fn yield_rate(&self) -> YieldRateView {
        YieldRateView {
            apy_bps: self.apy_bps,
            time_multiplier: self.time_multiplier,
        }
    }
}

impl Vault {
    pub(crate) fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "only the owner"
        );
    }

    pub(crate) fn assert_role(&self, role: Role) {
        if !self.role_set(role).contains(&env::predecessor_account_id()) {
            env::panic_str(&format!("missing role {role:?}"));
        }
    }

    fn role_set(&self, role: Role) -> &near_sdk::store::IterableSet<AccountId> {
        match role {
            Role::Guardian => &self.guardians,
            Role::Keeper => &self.keepers,
            Role::Operator => &self.operators,
        }
    }

    fn role_set_mut(&mut self, role: Role) -> &mut near_sdk::store::IterableSet<AccountId> {
        match role {
            Role::Guardian => &mut self.guardians,
            Role::Keeper => &mut self.keepers,
            Role::Operator => &mut self.operators,
        }
    }

    fn emit_rate(&self) {
        VaultEvent::VaultYieldRateUpdated {
            apy_bps: self.apy_bps,
            time_multiplier: self.time_multiplier,
        }
        .emit();
    }
}
