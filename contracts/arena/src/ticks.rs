//! Per-asset ring buffer of price ticks written by the pusher.

use near_sdk::{env, near, require};

use crate::events::{ArenaEvent, PushedTick};
use crate::types::{AssetId, Role, Tick, TickIndex, TickInput, TickView};
use crate::{Arena, ArenaExt};

#[near]
impl Arena {
    /// Pusher: appends ticks for any number of assets. The whole call fails on an unknown or inactive asset, a
    /// non-positive price, or a publish time in the future. An entry not newer than the asset's latest tick is
    /// skipped.
    pub fn push_ticks(&mut self, ticks: Vec<TickInput>) {
        self.assert_role(Role::Pusher);
        let now = Self::now_ms();
        for t in &ticks {
            require!(self.is_tradable_internal(t.asset_id), "asset not active");
            require!(t.price > 0, "price must be positive");
            require!(t.publish_ms <= now, "publish time in the future");
        }
        let mut pushed = Vec::with_capacity(ticks.len());
        for t in ticks {
            let latest = self.latest_index(t.asset_id);
            if latest != 0 && t.publish_ms <= self.tick_unchecked(t.asset_id, latest).publish_ms {
                continue;
            }
            let index = latest + 1;
            self.ticks.insert(
                (t.asset_id, index % self.ring_size),
                Tick {
                    price: t.price,
                    expo: t.expo,
                    publish_ms: t.publish_ms,
                },
            );
            self.latest_tick.insert(t.asset_id, index);
            pushed.push(PushedTick {
                asset_id: t.asset_id,
                index,
                price: t.price,
                expo: t.expo,
                publish_ms: t.publish_ms,
            });
        }
        if !pushed.is_empty() {
            ArenaEvent::TicksPushed { ticks: pushed }.emit();
        }
    }

    /// Fails for index 0, an index above the latest, or an index already overwritten.
    pub fn get_tick(&self, asset_id: AssetId, index: TickIndex) -> TickView {
        let tick = self.tick(asset_id, index);
        TickView {
            index,
            price: tick.price,
            expo: tick.expo,
            publish_ms: tick.publish_ms,
        }
    }

    /// Fails when the asset has no tick.
    pub fn latest_tick(&self, asset_id: AssetId) -> TickView {
        let index = self.latest_index(asset_id);
        require!(index != 0, "no tick for asset");
        self.get_tick(asset_id, index)
    }

    /// Latest tick index of the asset, 0 when it has none.
    pub fn latest_tick_index(&self, asset_id: AssetId) -> TickIndex {
        self.latest_index(asset_id)
    }

    pub fn is_stale(&self, asset_id: AssetId) -> bool {
        self.is_stale_with(asset_id, self.params.max_staleness_ms)
    }

    /// Index of the newest tick still in the ring with `publish_ms <= ts_ms`. Fails when there is none.
    pub fn tick_at(&self, asset_id: AssetId, ts_ms: u64) -> TickIndex {
        self.try_tick_at(asset_id, ts_ms)
            .unwrap_or_else(|| env::panic_str("no tick at or before that time"))
    }

    pub fn ring_size(&self) -> u32 {
        self.ring_size
    }
}

impl Arena {
    pub(crate) fn latest_index(&self, asset_id: AssetId) -> TickIndex {
        self.latest_tick.get(&asset_id).copied().unwrap_or(0)
    }

    fn tick_unchecked(&self, asset_id: AssetId, index: TickIndex) -> &Tick {
        self.ticks
            .get(&(asset_id, index % self.ring_size))
            .unwrap_or_else(|| env::panic_str("tick missing"))
    }

    /// Oldest index still held by the ring, or 0 when the asset has no tick.
    fn oldest_index(&self, latest: TickIndex) -> TickIndex {
        if latest == 0 {
            0
        } else if latest >= self.ring_size {
            latest - self.ring_size + 1
        } else {
            1
        }
    }

    pub(crate) fn try_tick(&self, asset_id: AssetId, index: TickIndex) -> Option<&Tick> {
        let latest = self.latest_index(asset_id);
        if index == 0 || index > latest || latest - index >= self.ring_size {
            return None;
        }
        Some(self.tick_unchecked(asset_id, index))
    }

    pub(crate) fn tick(&self, asset_id: AssetId, index: TickIndex) -> &Tick {
        self.try_tick(asset_id, index)
            .unwrap_or_else(|| env::panic_str("tick out of range"))
    }

    pub(crate) fn is_stale_with(&self, asset_id: AssetId, max_staleness_ms: u64) -> bool {
        let latest = self.latest_index(asset_id);
        if latest == 0 {
            return true;
        }
        let published = self.tick_unchecked(asset_id, latest).publish_ms;
        Self::now_ms().saturating_sub(published) > max_staleness_ms
    }

    pub(crate) fn try_tick_at(&self, asset_id: AssetId, ts_ms: u64) -> Option<TickIndex> {
        let mut hi = self.latest_index(asset_id);
        if hi == 0 {
            return None;
        }
        let mut lo = self.oldest_index(hi);
        if self.tick_unchecked(asset_id, lo).publish_ms > ts_ms {
            return None;
        }
        // Invariant: tick `lo` is published at or before `ts_ms`. Find the last such index.
        while lo < hi {
            let mid = lo + (hi - lo).div_ceil(2);
            if self.tick_unchecked(asset_id, mid).publish_ms <= ts_ms {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        Some(lo)
    }
}
