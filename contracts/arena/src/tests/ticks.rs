//! `price-ticks` scenarios.

use super::*;

fn tick(asset_id: AssetId, price: i64, publish_ms: u64) -> TickInput {
    TickInput {
        asset_id,
        price,
        expo: EXPO,
        publish_ms,
    }
}

#[test]
fn two_assets_in_one_call() {
    let mut w = World::new();
    w.advance(T0 + 500);
    w.call(&pusher())
        .push_ticks(vec![tick(1, 10, T0 + 500), tick(3, 30, T0 + 400)]);
    let pushed = events();
    assert_eq!(pushed.len(), 1);
    let list = pushed[0]["data"]["ticks"].as_array().unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0]["asset_id"], 1);
    assert_eq!(list[0]["index"], 1);
    assert_eq!(list[1]["asset_id"], 3);
    assert_eq!(w.arena.latest_tick(1).price, 10);
    assert_eq!(w.arena.latest_tick(3).publish_ms, T0 + 400);
}

#[test]
fn invalid_entry_fails_whole_batch() {
    let mut w = World::new();
    w.advance(T0 + 500);
    let now = w.now;
    for bad in [
        tick(1, 0, now),
        tick(1, -5, now),
        tick(9, 1, now),
        tick(0, 1, now),
        tick(1, 1, now + 1),
    ] {
        assert!(fails(|| w
            .call(&pusher())
            .push_ticks(vec![tick(1, 10, now), bad.clone()])));
        ctx(&stranger(), now);
        assert_eq!(
            w.arena.latest_tick_index(1),
            0,
            "nothing appended for {bad:?}"
        );
    }
}

#[test]
fn not_a_pusher() {
    let mut w = World::new();
    assert!(fails(|| w
        .call(&stranger())
        .push_ticks(vec![tick(1, 1, T0)])));
    assert!(fails(|| w.call(&owner()).push_ticks(vec![tick(1, 1, T0)])));
}

#[test]
fn duplicate_publish_time_is_skipped() {
    let mut w = World::new();
    w.advance(T0 + 2_000);
    let before = w.arena.latest_tick_index(1);
    w.call(&pusher()).push_ticks(vec![
        tick(1, 10, T0 + 2_000),
        tick(1, 11, T0 + 2_000),
        tick(1, 12, T0 + 1_000),
    ]);
    let list = events()[0]["data"]["ticks"].as_array().unwrap().clone();
    assert_eq!(list.len(), 1);
    assert_eq!(w.arena.latest_tick_index(1), before + 1);
    assert_eq!(w.arena.latest_tick(1).price, 10);

    // A batch with only duplicates logs nothing.
    w.call(&pusher()).push_ticks(vec![tick(1, 13, T0 + 2_000)]);
    assert!(events().is_empty());
}

#[test]
fn ring_wrap_overwrites_oldest() {
    let mut w = World::with_ring(Some(64));
    let ring = w.arena.ring_size();
    assert_eq!(ring, 64);
    // Tick 1 of BTC exists at T0; push `ring` more (in steps, `advance` only back-fills one minute).
    w.advance(T0 + 40_000);
    w.advance(T0 + u64::from(ring) * 1_000);
    ctx(&stranger(), w.now);
    assert_eq!(w.arena.latest_tick_index(BTC), ring + 1);
    assert!(fails(|| w.arena.get_tick(BTC, 1)));
    assert_eq!(w.arena.get_tick(BTC, 2).publish_ms, T0 + 1_000);
    assert_eq!(w.arena.get_tick(BTC, ring + 1).index, ring + 1);
    assert!(fails(|| w.arena.get_tick(BTC, 0)));
    assert!(fails(|| w.arena.get_tick(BTC, ring + 2)));
    // tick_at only searches the live window.
    assert!(fails(|| w.arena.tick_at(BTC, T0 + 500)));
    assert_eq!(w.arena.tick_at(BTC, T0 + 1_500), 2);
    assert_eq!(w.arena.tick_at(BTC, T0 + 40_200), 41);
    assert_eq!(w.arena.tick_at(BTC, u64::MAX), ring + 1);
}

#[test]
fn latest_tick_without_ticks_fails() {
    let w = World::new();
    ctx(&stranger(), T0);
    assert!(fails(|| w.arena.latest_tick(1)));
    assert_eq!(w.arena.latest_tick_index(1), 0);
    assert!(w.arena.is_stale(1));
    assert!(fails(|| w.arena.tick_at(1, T0)));
}

#[test]
fn staleness() {
    let mut w = World::new();
    w.feed_on = false;
    ctx(&stranger(), T0 + 3_000);
    assert!(!w.arena.is_stale(BTC), "3 s old is fresh");
    ctx(&stranger(), T0 + 5_000);
    assert!(!w.arena.is_stale(BTC), "exactly the limit is fresh");
    ctx(&stranger(), T0 + 6_000);
    assert!(w.arena.is_stale(BTC), "6 s old is stale");
}

#[test]
fn tick_at_between_two_ticks() {
    let mut w = World::new();
    // BTC ticks 1..=10 at T0 .. T0+9s, then tick 11 at T0+100s and tick 12 two seconds later.
    w.advance(T0 + 9_000);
    ctx(&pusher(), T0 + 100_000);
    w.arena.push_ticks(vec![tick(BTC, P, T0 + 100_000)]);
    ctx(&pusher(), T0 + 102_000);
    w.arena.push_ticks(vec![tick(BTC, P, T0 + 102_000)]);
    ctx(&stranger(), T0 + 102_000);
    assert_eq!(w.arena.latest_tick_index(BTC), 12);
    assert_eq!(w.arena.tick_at(BTC, T0 + 101_000), 11);
    assert_eq!(w.arena.tick_at(BTC, T0 + 100_000), 11);
    assert_eq!(w.arena.tick_at(BTC, T0 + 102_000), 12);
    assert_eq!(w.arena.tick_at(BTC, T0 + 4_999), 5);
    assert_eq!(w.arena.tick_at(BTC, T0), 1);
    assert!(
        fails(|| w.arena.tick_at(BTC, T0 - 1)),
        "older than the ring"
    );
}
