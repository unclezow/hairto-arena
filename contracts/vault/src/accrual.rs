//! Continuous mock yield. Each pool accrues `apy_bps × time_multiplier / (10 000 × year)` per unit of principal per
//! millisecond. Pool gross yield is split into fee, pot and owner yield; each account's owner yield follows its own
//! principal and time through a per-unit accumulator. All rounding floors.

use near_sdk::env;

use crate::account::Account;
use crate::pool::{Pool, PoolState};
use crate::Vault;

/// Fixed-point scale of the per-unit accumulators.
pub const ACC_SCALE: u128 = 1_000_000_000_000_000_000_000_000;
pub const BPS: u128 = 10_000;
pub const YEAR_MS: u128 = 365 * 24 * 3_600 * 1_000;

/// `a × b / c` with a 256-bit intermediate product, floored. Fails only if the result exceeds `u128`.
pub fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    assert!(c != 0, "division by zero");
    let (hi, lo) = mul_wide(a, b);
    if hi == 0 {
        return lo / c;
    }
    if hi >= c {
        env::panic_str("arithmetic overflow");
    }
    // Long division of (hi, lo) by c, one bit at a time; `rem < c` holds before every step.
    let mut rem = hi;
    let mut quotient: u128 = 0;
    for i in (0..128).rev() {
        let carry = rem >> 127;
        rem = (rem << 1) | ((lo >> i) & 1);
        quotient <<= 1;
        if carry == 1 || rem >= c {
            rem = rem.wrapping_sub(c);
            quotient |= 1;
        }
    }
    quotient
}

fn mul_wide(a: u128, b: u128) -> (u128, u128) {
    const MASK: u128 = u64::MAX as u128;
    let (a_hi, a_lo) = (a >> 64, a & MASK);
    let (b_hi, b_lo) = (b >> 64, b & MASK);
    let ll = a_lo * b_lo;
    let lh = a_lo * b_hi;
    let hl = a_hi * b_lo;
    let hh = a_hi * b_hi;
    let mid = (ll >> 64) + (lh & MASK) + (hl & MASK);
    let lo = (ll & MASK) | (mid << 64);
    let hi = hh + (lh >> 64) + (hl >> 64) + (mid >> 64);
    (hi, lo)
}

/// The split of a gross amount: `(fee, pot, owners)`.
pub fn split(gross: u128, fee_bps: u16, owner_share_bps: u16) -> (u128, u128, u128) {
    let fee = gross * u128::from(fee_bps) / BPS;
    let owners = (gross - fee) * u128::from(owner_share_bps) / BPS;
    (fee, gross - fee - owners, owners)
}

/// Accumulator growth over `elapsed_ms` at the given rate.
pub fn acc_delta(apy_bps: u16, time_multiplier: u32, elapsed_ms: u64) -> u128 {
    let numerator = u128::from(apy_bps) * u128::from(time_multiplier) * u128::from(elapsed_ms);
    mul_div(numerator, ACC_SCALE, BPS * YEAR_MS)
}

/// Pool state brought up to `now_ms`, plus the `(fee, pot, owners)` accrued on the way.
pub fn accrued_pool(
    pool: &PoolState,
    apy_bps: u16,
    time_multiplier: u32,
    now_ms: u64,
) -> (PoolState, (u128, u128, u128)) {
    let mut next = pool.clone();
    let elapsed = now_ms.saturating_sub(pool.last_accrual_ms);
    next.last_accrual_ms = now_ms.max(pool.last_accrual_ms);
    if elapsed == 0 {
        return (next, (0, 0, 0));
    }
    let delta = acc_delta(apy_bps, time_multiplier, elapsed);
    let config = &pool.config;
    // Owner yield per unit: the post-fee share, computed per unit so config changes never re-price past yield.
    let owner_factor = (BPS - u128::from(config.fee_bps)) * u128::from(config.owner_share_bps);
    next.acc_per_unit += delta;
    next.acc_owner_per_unit += mul_div(delta, owner_factor, BPS * BPS);
    let gross = mul_div(pool.total_principal, delta, ACC_SCALE);
    let parts = split(gross, config.fee_bps, config.owner_share_bps);
    next.since_harvest.fee.0 += parts.0;
    next.since_harvest.pot.0 += parts.1;
    next.since_harvest.owners.0 += parts.2;
    (next, parts)
}

/// Owner yield owed to `account` up to the pool's current accumulator.
pub fn owed_with(account: &Account, pool: &PoolState) -> u128 {
    let growth = pool.acc_owner_per_unit - account.owner_paid;
    account.owed + mul_div(account.principal, growth, ACC_SCALE)
}

impl Vault {
    pub(crate) fn pool(&self, pool: Pool) -> &PoolState {
        match pool {
            Pool::Fighter => &self.fighter,
            Pool::Backer => &self.backer,
        }
    }

    fn pool_mut(&mut self, pool: Pool) -> &mut PoolState {
        match pool {
            Pool::Fighter => &mut self.fighter,
            Pool::Backer => &mut self.backer,
        }
    }

    /// Accrues one pool up to now and moves its fee and pot shares to the pending payouts.
    pub(crate) fn accrue_pool(&mut self, pool: Pool) {
        let (next, (fee, pot, _)) = accrued_pool(
            self.pool(pool),
            self.apy_bps,
            self.time_multiplier,
            Self::now_ms(),
        );
        *self.pool_mut(pool) = next;
        self.pending_fee += fee;
        self.pending_pot += pot;
    }

    pub(crate) fn accrue_all(&mut self) {
        self.accrue_pool(Pool::Fighter);
        self.accrue_pool(Pool::Backer);
    }

    /// Settles an account's owner yield against its (already accrued) pool.
    pub(crate) fn settle(&self, account: &mut Account, pool: Pool) {
        let state = self.pool(pool);
        account.owed = owed_with(account, state);
        account.owner_paid = state.acc_owner_per_unit;
    }

    /// Adds (positive) or removes principal from an account and its pool. Both must be accrued and settled.
    pub(crate) fn change_principal(
        &mut self,
        account: &mut Account,
        pool: Pool,
        add: u128,
        sub: u128,
    ) {
        account.principal = account.principal + add - sub;
        let state = self.pool_mut(pool);
        state.total_principal = state.total_principal + add - sub;
    }

    /// Pending `(fee, pot)` including accrual up to now, without changing state.
    pub(crate) fn live_pending(&self) -> (u128, u128) {
        let now = Self::now_ms();
        let mut fee = self.pending_fee;
        let mut pot = self.pending_pot;
        for pool in [Pool::Fighter, Pool::Backer] {
            let (_, (f, p, _)) =
                accrued_pool(self.pool(pool), self.apy_bps, self.time_multiplier, now);
            fee += f;
            pot += p;
        }
        (fee, pot)
    }

    /// Owner yield owed to an account including accrual up to now.
    pub(crate) fn live_owed(&self, account: &Account) -> u128 {
        match account.role {
            Some(pool) => {
                let (state, _) = accrued_pool(
                    self.pool(pool),
                    self.apy_bps,
                    self.time_multiplier,
                    Self::now_ms(),
                );
                owed_with(account, &state)
            }
            None => account.owed,
        }
    }
}
