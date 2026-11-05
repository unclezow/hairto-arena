//! Backer picks: one locked pick of a Fighter per Backer per season, decided by two joined vault views.

use near_sdk::{env, near, require, AccountId, Promise, PromiseError};

use crate::duel::ext_vault;
use crate::events::ArenaEvent;
use crate::params::{
    GAS_FOR_CAN_PICK, GAS_FOR_ON_PICK, GAS_FOR_ROLE_OF, MIN_GAS_FOR_PICK, PENDING_TIMEOUT_MS,
};
use crate::types::{PendingPick, Phase, SeasonId, VaultPool};
use crate::{Arena, ArenaExt};

#[near]
impl Arena {
    /// Backer: picks `fighter` for the current season while it is in its pick window. The vault decides whether the
    /// caller can pick and whether `fighter` is a Fighter; the pick is stored in `on_pick` and never changes.
    pub fn pick(&mut self, fighter: AccountId) -> Promise {
        require!(
            env::prepaid_gas() >= MIN_GAS_FOR_PICK,
            "attach at least 50 Tgas"
        );
        let backer = env::predecessor_account_id();
        let season = self.current_season;
        require!(
            self.phase_of(season) == Some(Phase::Picking),
            "pick window closed"
        );
        require!(fighter != backer, "cannot pick yourself");
        require!(
            !self.pick_of.contains_key(&(season, backer.clone())),
            "already picked this season"
        );
        require!(
            !self.pending_picks.contains_key(&backer),
            "pick already pending"
        );
        self.pending_picks.insert(
            backer.clone(),
            PendingPick {
                season,
                fighter: fighter.clone(),
                since_ms: Self::now_ms(),
            },
        );

        let vault = self.vault_id.clone();
        ext_vault::ext(vault.clone())
            .with_static_gas(GAS_FOR_CAN_PICK)
            .can_pick(backer.clone())
            .and(
                ext_vault::ext(vault)
                    .with_static_gas(GAS_FOR_ROLE_OF)
                    .role_of(fighter.clone()),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_ON_PICK)
                    .on_pick(backer, season, fighter),
            )
    }

    /// Callback of `pick`. Stores the pick, or clears the pending mark and emits `pick_rejected`.
    #[private]
    pub fn on_pick(
        &mut self,
        backer: AccountId,
        season: SeasonId,
        fighter: AccountId,
        #[callback_result] can_pick: Result<bool, PromiseError>,
        #[callback_result] role: Result<Option<VaultPool>, PromiseError>,
    ) -> bool {
        let pending = self
            .pending_picks
            .get(&backer)
            .is_some_and(|p| p.season == season && p.fighter == fighter);
        if !pending {
            // Cleared by `clear_stale_pick`; leave any newer state alone.
            return false;
        }
        self.pending_picks.remove(&backer);
        let reason = match (can_pick, role) {
            (Err(_), _) | (_, Err(_)) => Some("vault_error"),
            (Ok(false), _) => Some("not_eligible_backer"),
            (Ok(true), Ok(role)) if role != Some(VaultPool::Fighter) => Some("not_a_fighter"),
            (Ok(true), Ok(_)) => None,
        };
        if let Some(reason) = reason {
            ArenaEvent::PickRejected {
                season,
                backer,
                fighter,
                reason: reason.to_string(),
            }
            .emit();
            return false;
        }
        let count_key = (season, fighter.clone());
        let count = self.backer_count.get(&count_key).copied().unwrap_or(0) + 1;
        self.backer_count.insert(count_key, count);
        self.pick_of
            .insert((season, backer.clone()), fighter.clone());
        ArenaEvent::Picked {
            season,
            backer,
            fighter,
            backer_count: count,
        }
        .emit();
        true
    }

    /// Anyone: clears a pending pick whose callback never ran, 60 s after it started.
    pub fn clear_stale_pick(&mut self, backer: AccountId) {
        let pending = self
            .pending_picks
            .get(&backer)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no pending pick"));
        require!(
            Self::now_ms() >= pending.since_ms + PENDING_TIMEOUT_MS,
            "pending pick not stale yet"
        );
        self.pending_picks.remove(&backer);
        ArenaEvent::PickRejected {
            season: pending.season,
            backer,
            fighter: pending.fighter,
            reason: "pending_timeout".to_string(),
        }
        .emit();
    }

    /// The Fighter `backer` picked in `season`, if any.
    pub fn pick_of(&self, season: SeasonId, backer: AccountId) -> Option<AccountId> {
        self.pick_of.get(&(season, backer)).cloned()
    }

    /// How many Backers picked `fighter` in `season`.
    pub fn backer_count(&self, season: SeasonId, fighter: AccountId) -> u32 {
        self.backer_count
            .get(&(season, fighter))
            .copied()
            .unwrap_or(0)
    }

    pub fn pending_pick_of(&self, backer: AccountId) -> Option<PendingPick> {
        self.pending_picks.get(&backer).cloned()
    }
}
