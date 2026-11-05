//! Season lifecycle: start, computed phases, early end, close, bounded durations.

use near_sdk::{env, near, require};

use crate::events::ArenaEvent;
use crate::params::{
    MAX_CLAIM_PERIOD_MS, MAX_CLOSE_DELAY_MS, MAX_DISPUTE_WINDOW_MS, MAX_SEASON_DURATION_MS,
    MIN_CLAIM_PERIOD_MS, MIN_CLOSE_DELAY_MS, MIN_DISPUTE_WINDOW_MS, MIN_SEASON_DURATION_MS,
};
use crate::types::{AssetId, Durations, Phase, Role, Season, SeasonId, SeasonView};
use crate::{Arena, ArenaExt};

fn require_range(value: u64, min: u64, max: u64, name: &str) {
    if value < min || value > max {
        env::panic_str(&format!("{name} out of range"));
    }
}

#[near]
impl Arena {
    /// Operator: starts the next season. The previous one must be `Closed`.
    pub fn start_season(&mut self, asset_ids: Vec<AssetId>) -> SeasonId {
        self.assert_role(Role::Operator);
        if self.current_season != 0 {
            require!(
                self.phase_of(self.current_season) == Some(Phase::Closed),
                "current season not closed"
            );
        }
        for id in &asset_ids {
            require!(self.asset(*id).is_some(), "unknown asset");
        }
        let now = Self::now_ms();
        let d = self.durations.clone();
        let season = self.current_season + 1;
        let record = Season {
            start_ms: now,
            pick_end_ms: now + d.pick_window_ms,
            end_ms: now + d.season_duration_ms,
            phase: Phase::Active,
            closed_ms: None,
            close_delay_ms: d.close_delay_ms,
            dispute_window_ms: d.dispute_window_ms,
            claim_period_ms: d.claim_period_ms,
            asset_ids: asset_ids.clone(),
        };
        ArenaEvent::SeasonStarted {
            season,
            start_ms: record.start_ms,
            pick_end_ms: record.pick_end_ms,
            end_ms: record.end_ms,
            asset_ids,
        }
        .emit();
        self.seasons.insert(season, record);
        self.current_season = season;
        season
    }

    /// Operator: ends the running season now and drops its close delay (demos).
    pub fn end_season_now(&mut self) {
        self.assert_role(Role::Operator);
        let season = self.current_season;
        let open = self.phase_of(season).is_some_and(Phase::is_open);
        let now = Self::now_ms();
        let s = self
            .seasons
            .get_mut(&season)
            .unwrap_or_else(|| env::panic_str("no season"));
        require!(open && now < s.end_ms, "season not running");
        s.end_ms = now;
        s.pick_end_ms = s.pick_end_ms.min(now);
        s.close_delay_ms = 0;
        ArenaEvent::SeasonEndedEarly {
            season,
            end_ms: now,
        }
        .emit();
    }

    /// Anyone: closes the current season once its end plus close delay has passed.
    pub fn close_season(&mut self) {
        let season = self.current_season;
        let open = self.phase_of(season).is_some_and(Phase::is_open);
        let now = Self::now_ms();
        let s = self
            .seasons
            .get_mut(&season)
            .unwrap_or_else(|| env::panic_str("no season"));
        require!(open, "season not open");
        require!(
            now >= s.end_ms + s.close_delay_ms,
            "season close delay not over"
        );
        s.phase = Phase::Closed;
        s.closed_ms = Some(now);
        ArenaEvent::SeasonClosed {
            season,
            closed_ms: now,
        }
        .emit();
    }

    /// Operator: durations for seasons started afterwards, in milliseconds.
    pub fn set_durations(
        &mut self,
        season_duration_ms: u64,
        pick_window_ms: u64,
        dispute_window_ms: u64,
        close_delay_ms: u64,
        claim_period_ms: u64,
    ) {
        self.assert_role(Role::Operator);
        require_range(
            season_duration_ms,
            MIN_SEASON_DURATION_MS,
            MAX_SEASON_DURATION_MS,
            "season_duration_ms",
        );
        require_range(pick_window_ms, 0, season_duration_ms, "pick_window_ms");
        require_range(
            dispute_window_ms,
            MIN_DISPUTE_WINDOW_MS,
            MAX_DISPUTE_WINDOW_MS,
            "dispute_window_ms",
        );
        require_range(
            close_delay_ms,
            MIN_CLOSE_DELAY_MS,
            MAX_CLOSE_DELAY_MS,
            "close_delay_ms",
        );
        require_range(
            claim_period_ms,
            MIN_CLAIM_PERIOD_MS,
            MAX_CLAIM_PERIOD_MS,
            "claim_period_ms",
        );
        self.durations = Durations {
            season_duration_ms,
            pick_window_ms,
            dispute_window_ms,
            close_delay_ms,
            claim_period_ms,
        };
        ArenaEvent::DurationsUpdated {
            durations: self.durations.clone(),
        }
        .emit();
    }

    pub fn current_season(&self) -> SeasonId {
        self.current_season
    }

    pub fn get_season(&self, season: SeasonId) -> Option<SeasonView> {
        let s = self.seasons.get(&season)?;
        Some(SeasonView {
            season,
            phase: Self::computed_phase(s),
            start_ms: s.start_ms,
            pick_end_ms: s.pick_end_ms,
            end_ms: s.end_ms,
            closed_ms: s.closed_ms,
            close_delay_ms: s.close_delay_ms,
            dispute_window_ms: s.dispute_window_ms,
            claim_period_ms: s.claim_period_ms,
            asset_ids: s.asset_ids.clone(),
        })
    }

    pub fn get_durations(&self) -> Durations {
        self.durations.clone()
    }
}

impl Arena {
    fn computed_phase(s: &Season) -> Phase {
        match s.phase {
            Phase::Active if Self::now_ms() < s.pick_end_ms => Phase::Picking,
            phase => phase,
        }
    }

    pub(crate) fn phase_of(&self, season: SeasonId) -> Option<Phase> {
        self.seasons.get(&season).map(Self::computed_phase)
    }

    /// The current season if a duel created now (starting after `countdown_ms`) fits inside it.
    pub(crate) fn open_season_for_duel(&self, countdown_ms: u64) -> Option<SeasonId> {
        let season = self.current_season;
        let s = self.seasons.get(&season)?;
        let fits = Self::now_ms()
            + countdown_ms
            + crate::params::ROUND_MS
            + crate::params::REVEAL_GRACE_MS
            <= s.end_ms;
        (Self::computed_phase(s).is_open() && fits).then_some(season)
    }
}
