//! Performance season points: signed, HP-margin-interpolated per bot level, with a zero floor.

use near_sdk::{near, AccountId};

use crate::events::ArenaEvent;
use crate::params::{MIN_DUELS_FOR_LEADERBOARD, POINTS_BY_LEVEL, STARTING_HP};
use crate::types::{BotLevel, DuelId, Outcome, Score, SeasonId};
use crate::{Arena, ArenaExt};

/// Signed points for one result. A forfeit costs the level's maximum loss, a draw is 0, otherwise
/// `min + (max - min) * |hp_fighter - hp_bot| / 1000` with the win or loss range of the level.
pub fn points_for(
    level: BotLevel,
    outcome: Outcome,
    hp_fighter: u16,
    hp_bot: u16,
    forfeited: bool,
) -> i64 {
    let Some(range) = usize::from(level)
        .checked_sub(1)
        .and_then(|i| POINTS_BY_LEVEL.get(i))
    else {
        return 0;
    };
    if forfeited {
        return -(range.loss_max as i64);
    }
    let (min, max) = match outcome {
        Outcome::Draw => return 0,
        Outcome::Win => (range.win_min, range.win_max),
        Outcome::Loss => (range.loss_min, range.loss_max),
    };
    let margin = u64::from(hp_fighter.abs_diff(hp_bot).min(STARTING_HP));
    let magnitude = (min + (max - min) * margin / u64::from(STARTING_HP)) as i64;
    if outcome == Outcome::Win {
        magnitude
    } else {
        -magnitude
    }
}

#[near]
impl Arena {
    pub fn score_of(&self, season: SeasonId, fighter: AccountId) -> Score {
        self.scores
            .get(&(season, fighter))
            .cloned()
            .unwrap_or_default()
    }

    /// True once the Fighter has at least 10 recorded duels in the season.
    pub fn is_eligible(&self, season: SeasonId, fighter: AccountId) -> bool {
        self.score_of(season, fighter).duels >= MIN_DUELS_FOR_LEADERBOARD
    }
}

impl Arena {
    /// Records one result. Called only from a timely seed reveal, so each duel is recorded at most once.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn record_result(
        &mut self,
        season: SeasonId,
        fighter: AccountId,
        duel_id: DuelId,
        level: BotLevel,
        outcome: Outcome,
        hp_fighter: u16,
        hp_bot: u16,
        forfeited: bool,
    ) {
        let mut points = points_for(level, outcome, hp_fighter, hp_bot, forfeited);
        let now = Self::now_ms();
        let key = (season, fighter.clone());
        let mut score = self.scores.get(&key).cloned().unwrap_or_default();
        score.duels += 1;
        if outcome == Outcome::Win {
            score.wins += 1;
        }
        if points < 0 {
            let penalty = points.unsigned_abs().min(score.points);
            score.points -= penalty;
            points = -(penalty as i64);
        } else {
            score.points += points as u64;
        }
        if points != 0 {
            score.reached_at_ms = now;
        }
        self.scores.insert(key, score);
        ArenaEvent::ResultRecorded {
            season,
            fighter,
            duel_id,
            outcome,
            points,
        }
        .emit();
    }
}
