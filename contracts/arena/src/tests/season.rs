//! `season-lifecycle` scenarios.

use super::*;
use crate::types::Phase;

const MIN: u64 = 60_000;
const HOUR: u64 = 60 * MIN;

#[test]
fn first_season() {
    let w = World::new();
    ctx(&stranger(), T0);
    assert_eq!(w.arena.current_season(), 1);
    let s = w.arena.get_season(1).unwrap();
    assert_eq!(s.phase, Phase::Picking);
    assert_eq!(s.start_ms, T0);
    assert_eq!(s.pick_end_ms, T0 + 24 * HOUR);
    assert_eq!(s.end_ms, T0 + 7 * 24 * HOUR);
    assert_eq!(s.close_delay_ms, 15 * MIN);
    assert_eq!(s.asset_ids, vec![1, 2, 3]);
    assert!(w.arena.get_season(2).is_none());
}

#[test]
fn season_started_event() {
    ctx(&owner(), T0);
    let key = ed25519_dalek::SigningKey::from_bytes(&[1; 32]);
    let mut arena = Arena::new(owner(), vault(), public_key(&key), None);
    arena.grant_role(Role::Operator, operator());
    arena.add_asset(feed(1), "GOOGL".into());
    ctx(&operator(), T0);
    assert_eq!(arena.start_season(vec![1]), 1);
    let e = find_event("season_started").unwrap();
    assert_eq!(e["data"]["season"], 1);
    assert_eq!(e["data"]["asset_ids"][0], 1);
    assert!(fails(|| arena.start_season(vec![])));
}

#[test]
fn start_requires_operator_and_known_assets() {
    let mut w = World::new();
    w.advance(T0 + 7 * 24 * HOUR + 15 * MIN);
    w.call(&stranger()).close_season();
    assert!(fails(|| w.call(&stranger()).start_season(vec![1])));
    assert!(fails(|| w.call(&owner()).start_season(vec![1])));
    assert!(fails(|| w.call(&operator()).start_season(vec![9])));
    assert_eq!(w.call(&operator()).start_season(vec![1]), 2);
}

#[test]
fn previous_season_still_running() {
    let mut w = World::new();
    w.advance(T0 + 25 * HOUR);
    assert!(fails(|| w.call(&operator()).start_season(vec![1])));
}

#[test]
fn phase_after_pick_window() {
    let mut w = World::new();
    w.advance(T0 + 24 * HOUR - 1);
    assert_eq!(
        w.call(&stranger()).get_season(1).unwrap().phase,
        Phase::Picking
    );
    w.advance(T0 + 25 * HOUR);
    assert_eq!(
        w.call(&stranger()).get_season(1).unwrap().phase,
        Phase::Active
    );
    // Still Active after end_ms until someone closes it.
    w.advance(T0 + 8 * 24 * HOUR);
    assert_eq!(
        w.call(&stranger()).get_season(1).unwrap().phase,
        Phase::Active
    );
}

#[test]
fn demo_end_and_immediate_close() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start);
    w.open(id, &fighter(), Dir::Long, 1);

    w.advance(start + 4_000);
    assert!(fails(|| w.call(&stranger()).end_season_now()));
    w.call(&operator()).end_season_now();
    let e = find_event("season_ended_early").unwrap();
    assert_eq!(e["data"]["end_ms"], start + 4_000);
    let s = w.arena.get_season(1).unwrap();
    assert_eq!(s.end_ms, start + 4_000);
    assert_eq!(s.pick_end_ms, start + 4_000);
    assert_eq!(s.close_delay_ms, 0);
    assert!(
        fails(|| w.call(&operator()).end_season_now()),
        "already ended"
    );

    w.call(&stranger()).close_season();
    assert_eq!(event_names(), vec!["season_closed"]);
    let s = w.arena.get_season(1).unwrap();
    assert_eq!(s.phase, Phase::Closed);
    assert_eq!(s.closed_ms, Some(start + 4_000));

    // The running duel finishes but is not scored after the close.
    w.close(id, &fighter(), Dir::Long, 1);
    w.advance(start + 40_000);
    w.call(&stranger()).settle_duel(id);
    w.reveal(id);
    assert!(event_names().iter().all(|n| n != "result_recorded"));
    assert_eq!(w.arena.score_of(1, fighter()).duels, 0);
    // No new duel can start in a closed season.
    let ticket = w.ticket(&fighter(), BTC, 1);
    let sig = w.sign(&ticket);
    assert!(fails(|| w.call(&fighter()).start_duel(ticket, sig)));
}

#[test]
fn close_too_early() {
    let mut w = World::new();
    w.advance(T0 + 7 * 24 * HOUR + MIN);
    assert!(fails(|| w.call(&stranger()).close_season()));
    w.advance(T0 + 7 * 24 * HOUR + 15 * MIN);
    w.call(&stranger()).close_season();
    assert!(
        fails(|| w.call(&stranger()).close_season()),
        "already closed"
    );
    assert!(fails(|| w.call(&operator()).end_season_now()));
}

#[test]
fn demo_season_durations() {
    let mut w = World::new();
    w.call(&operator())
        .set_durations(30 * MIN, 5 * MIN, MIN, MIN, MIN);
    let e = find_event("durations_updated").unwrap();
    assert_eq!(e["data"]["durations"]["season_duration_ms"], 30 * MIN);
    // The running season keeps its own durations.
    assert_eq!(w.arena.get_season(1).unwrap().end_ms, T0 + 7 * 24 * HOUR);

    w.advance(T0 + 7 * 24 * HOUR + 15 * MIN);
    w.call(&stranger()).close_season();
    let now = w.now;
    w.call(&operator()).start_season(vec![2]);
    let s = w.arena.get_season(2).unwrap();
    assert_eq!(s.end_ms, now + 30 * MIN);
    assert_eq!(s.pick_end_ms, now + 5 * MIN);
    assert_eq!(s.close_delay_ms, MIN);
}

#[test]
fn bounded_durations() {
    let mut w = World::new();
    let day = 24 * HOUR;
    let ok = (7 * day, day, HOUR, 15 * MIN, 30 * day);
    let bad = [
        (10 * MIN - 1, 0, HOUR, 15 * MIN, 30 * day),
        (90 * day + 1, 0, HOUR, 15 * MIN, 30 * day),
        (30 * MIN, 30 * MIN + 1, HOUR, 15 * MIN, 30 * day),
        (ok.0, ok.1, MIN - 1, ok.3, ok.4),
        (ok.0, ok.1, 7 * day + 1, ok.3, ok.4),
        (ok.0, ok.1, ok.2, MIN - 1, ok.4),
        (ok.0, ok.1, ok.2, day + 1, ok.4),
        (ok.0, ok.1, ok.2, ok.3, MIN - 1),
        (ok.0, ok.1, ok.2, ok.3, 365 * day + 1),
    ];
    for (a, b, c, d, e) in bad {
        assert!(fails(|| w.call(&operator()).set_durations(a, b, c, d, e)));
    }
    assert!(fails(|| w
        .call(&stranger())
        .set_durations(ok.0, ok.1, ok.2, ok.3, ok.4)));
    w.call(&operator())
        .set_durations(10 * MIN, 10 * MIN, MIN, MIN, MIN);
    w.call(&operator())
        .set_durations(90 * day, 0, 7 * day, day, 365 * day);
}
