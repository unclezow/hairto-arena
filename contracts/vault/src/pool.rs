//! The two pools, their configuration and accrual state.

use near_sdk::json_types::U128;
use near_sdk::near;

/// A depositor's pool, which is also their role.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pool {
    Fighter,
    Backer,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolConfig {
    /// USDC base units (6 decimals).
    pub min_deposit: U128,
    pub fee_bps: u16,
    /// Share of post-fee yield returned to the depositors of the pool.
    pub owner_share_bps: u16,
}

/// Yield accrued by a pool since the last harvest, for `vault_harvested`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Accrued {
    pub fee: U128,
    pub pot: U128,
    pub owners: U128,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolState {
    pub config: PoolConfig,
    pub total_principal: u128,
    /// Cumulative gross yield per unit of principal, scaled by `ACC_SCALE`.
    pub acc_per_unit: u128,
    /// Cumulative owner yield per unit of principal (after fee and pot), scaled by `ACC_SCALE`.
    pub acc_owner_per_unit: u128,
    pub last_accrual_ms: u64,
    pub since_harvest: Accrued,
}

impl PoolState {
    pub fn new(config: PoolConfig, now_ms: u64) -> Self {
        Self {
            config,
            total_principal: 0,
            acc_per_unit: 0,
            acc_owner_per_unit: 0,
            last_accrual_ms: now_ms,
            since_harvest: Accrued::default(),
        }
    }
}
