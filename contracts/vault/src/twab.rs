//! Time-weighted average principal of Backers, used by the keeper for Backer bonuses. Checkpoints persist after an
//! account exits so past seasons stay computable.

use near_sdk::json_types::U128;
use near_sdk::{near, require, AccountId};

use crate::{Vault, VaultExt};

/// Principal held from `ts_ms`, and cumulative principal-milliseconds up to `ts_ms`.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Checkpoint {
    pub ts_ms: u64,
    pub balance: u128,
    pub cumulative: u128,
}

#[near]
impl Vault {
    /// Time-weighted average principal over `[from_ms, to_ms)`. Fails when `from_ms >= to_ms` or `to_ms` is in the
    /// future.
    pub fn twab_of(&self, account_id: AccountId, from_ms: u64, to_ms: u64) -> U128 {
        require!(from_ms < to_ms && to_ms <= Self::now_ms(), "invalid range");
        let span = u128::from(to_ms - from_ms);
        U128(
            (self.cumulative_at(&account_id, to_ms) - self.cumulative_at(&account_id, from_ms))
                / span,
        )
    }
}

impl Vault {
    fn checkpoint_count(&self, account_id: &AccountId) -> u32 {
        self.twab_len.get(account_id).copied().unwrap_or(0)
    }

    fn checkpoint(&self, account_id: &AccountId, i: u32) -> &Checkpoint {
        self.checkpoints
            .get(&(account_id.clone(), i))
            .unwrap_or_else(|| near_sdk::env::abort())
    }

    /// Cumulative principal-milliseconds of `account_id` up to `ts_ms`.
    fn cumulative_at(&self, account_id: &AccountId, ts_ms: u64) -> u128 {
        let len = self.checkpoint_count(account_id);
        if len == 0 || self.checkpoint(account_id, 0).ts_ms > ts_ms {
            return 0;
        }
        // Last checkpoint with `ts_ms <= ts_ms`.
        let (mut lo, mut hi) = (0u32, len - 1);
        while lo < hi {
            let mid = lo + (hi - lo).div_ceil(2);
            if self.checkpoint(account_id, mid).ts_ms <= ts_ms {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        let cp = self.checkpoint(account_id, lo);
        cp.cumulative + cp.balance * u128::from(ts_ms - cp.ts_ms)
    }

    /// Records `balance` as the account's principal from now, overwriting a checkpoint from the same millisecond.
    pub(crate) fn write_checkpoint(&mut self, account_id: &AccountId, balance: u128) {
        let now = Self::now_ms();
        let len = self.checkpoint_count(account_id);
        if len > 0 {
            let last_key = (account_id.clone(), len - 1);
            let last = self.checkpoint(account_id, len - 1).clone();
            if last.ts_ms == now {
                self.checkpoints
                    .insert(last_key, Checkpoint { balance, ..last });
                return;
            }
        }
        let cumulative = self.cumulative_at(account_id, now);
        self.checkpoints.insert(
            (account_id.clone(), len),
            Checkpoint {
                ts_ms: now,
                balance,
                cumulative,
            },
        );
        self.twab_len.insert(account_id.clone(), len + 1);
    }
}
