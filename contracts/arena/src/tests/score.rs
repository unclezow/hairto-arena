//! `season-score` scenarios.

use super::*;
use crate::score::points_for;
use crate::types::Outcome;

#[test]
fn trend_win_by_600_hp() {
    assert_eq!(
        points_for(2, Outcome::Win, 800, 200, false),
        8 + 7 * 600 / 1_000
    );
    assert_eq!(points_for(2, Outcome::Win, 800, 200, false), 12);
}

#[test]
fn rookie_loss_by_1000_hp() {
    assert_eq!(points_for(1, Outcome::Loss, 0, 1_000, false), -10);
}

#[test]
fn forfeit_against_reversion() {
    assert_eq!(points_for(3, Outcome::Loss, 1_000, 1_000, true), -5);
}

#[test]
fn points_table() {
    // (level, win min, win max, loss min, loss max)
    let table = [
        (1, 5, 10, 4, 10),
        (2, 8, 15, 2, 7),
        (3, 12, 20, 1, 5),
        (4, 15, 25, 1, 4),
    ];
    for (level, wmin, wmax, lmin, lmax) in table {
        assert_eq!(points_for(level, Outcome::Win, 500, 500, false), wmin);
        assert_eq!(points_for(level, Outcome::Win, 1_000, 0, false), wmax);
        assert_eq!(points_for(level, Outcome::Loss, 500, 500, false), -lmin);
        assert_eq!(points_for(level, Outcome::Loss, 0, 1_000, false), -lmax);
        assert_eq!(points_for(level, Outcome::Draw, 900, 100, false), 0);
        assert_eq!(points_for(level, Outcome::Loss, 1_000, 1_000, true), -lmax);
    }
    // Oracle win by 300 HP: 15 + 10 × 300 / 1000 = 18.
    assert_eq!(points_for(4, Outcome::Win, 650, 350, false), 18);
    assert_eq!(points_for(0, Outcome::Win, 650, 350, false), 0);
}

fn record(w: &mut World, duel_id: DuelId, outcome: Outcome, hp_f: u16, hp_b: u16, forfeited: bool) {
    let now = w.now;
    ctx(&arena_id(), now);
    w.arena
        .record_result(1, fighter(), duel_id, 1, outcome, hp_f, hp_b, forfeited);
}

#[test]
fn zero_floor_and_counters() {
    let mut w = World::new();
    record(&mut w, 1, Outcome::Loss, 0, 1_000, false);
    let e = find_event("result_recorded").unwrap();
    assert_eq!(e["data"]["points"], 0);
    assert_eq!(e["data"]["outcome"], "Loss");
    let s = w.arena.score_of(1, fighter());
    assert_eq!((s.points, s.duels, s.wins, s.reached_at_ms), (0, 1, 0, 0));

    w.advance(T0 + 1_000);
    record(&mut w, 2, Outcome::Win, 1_000, 0, false);
    let s = w.arena.score_of(1, fighter());
    assert_eq!(
        (s.points, s.duels, s.wins, s.reached_at_ms),
        (10, 2, 1, T0 + 1_000)
    );

    // A deduction larger than the total clips at 0 and the event carries the actual change.
    w.advance(T0 + 2_000);
    record(&mut w, 3, Outcome::Win, 500, 500, false);
    record(&mut w, 4, Outcome::Loss, 1_000, 1_000, true);
    w.advance(T0 + 3_000);
    record(&mut w, 5, Outcome::Loss, 0, 1_000, false);
    assert_eq!(find_event("result_recorded").unwrap()["data"]["points"], -5);
    record(&mut w, 6, Outcome::Loss, 0, 1_000, false);
    assert_eq!(find_event("result_recorded").unwrap()["data"]["points"], 0);
    let s = w.arena.score_of(1, fighter());
    assert_eq!(
        (s.points, s.duels, s.wins, s.reached_at_ms),
        (0, 6, 2, T0 + 3_000)
    );

    // A draw changes nothing but the counter and keeps the tie-break time.
    w.advance(T0 + 4_000);
    record(&mut w, 7, Outcome::Draw, 400, 400, false);
    let s = w.arena.score_of(1, fighter());
    assert_eq!((s.points, s.duels, s.reached_at_ms), (0, 7, T0 + 3_000));
}

#[test]
fn eligibility_needs_ten_duels() {
    let mut w = World::new();
    for id in 1..=9 {
        record(&mut w, id, Outcome::Draw, 500, 500, false);
    }
    assert!(!w.arena.is_eligible(1, fighter()));
    record(&mut w, 10, Outcome::Draw, 500, 500, false);
    assert!(w.arena.is_eligible(1, fighter()));
    assert!(!w.arena.is_eligible(2, fighter()));
    assert_eq!(w.arena.score_of(1, stranger()).points, 0);
}

#[test]
fn late_reveal_records_nothing() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start + 40_000);
    w.call(&stranger()).settle_duel(id);
    w.advance(start + 40_000 + 11 * 60_000);
    w.reveal(id);
    assert_eq!(event_names(), vec!["bot_seed_revealed"]);
    assert_eq!(w.arena.score_of(1, fighter()).duels, 0);
    assert!(w.arena.get_duel(id).is_none());
}

#[test]
fn reveal_at_timeout_still_scores() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start + 40_000);
    w.call(&stranger()).settle_duel(id);
    w.advance(start + 40_000 + 600_000);
    w.reveal(id);
    assert_eq!(event_names(), vec!["bot_seed_revealed", "result_recorded"]);
    // Forfeit against Rookie costs 10, floored at 0.
    assert_eq!(w.arena.score_of(1, fighter()).duels, 1);
}

#[test]
fn season_closed_before_reveal() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start + 40_000);
    w.call(&stranger()).settle_duel(id);
    w.call(&operator()).end_season_now();
    w.call(&stranger()).close_season();
    w.reveal(id);
    assert_eq!(event_names(), vec!["bot_seed_revealed"]);
    assert_eq!(w.arena.score_of(1, fighter()).duels, 0);
}

#[test]
fn voided_duel_records_nothing() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.feed_on = false;
    w.advance(start + 12_000);
    w.call(&stranger()).void_duel(id);
    w.reveal(id);
    assert_eq!(event_names(), vec!["bot_seed_revealed"]);
    assert_eq!(w.arena.score_of(1, fighter()).duels, 0);
}
