//! `duel-lifecycle` scenarios.

use near_sdk::PromiseError;

use super::*;
use crate::types::{ActiveSlot, Outcome, Side, Status};

fn rookie() -> AccountId {
    bot_account(1)
}

/// BTC price for a move of `ppm` from `P`.
fn moved(ppm: i64) -> i64 {
    P + P * ppm / 1_000_000
}

// ---------------------------------------------------------------- start_duel checks

#[test]
fn someone_else_submits_the_ticket() {
    let mut w = World::new();
    let ticket = w.ticket(&fighter(), BTC, 1);
    let sig = w.sign(&ticket);
    assert!(fails(|| w.call(&stranger()).start_duel(ticket, sig)));
}

#[test]
fn expired_or_long_lived_ticket() {
    let mut w = World::new();
    w.advance(T0 + 10_000);
    let mut expired = w.ticket(&fighter(), BTC, 1);
    expired.deadline_ms = w.now - 1;
    let sig = w.sign(&expired);
    assert!(fails(|| w.call(&fighter()).start_duel(expired, sig)));

    let mut long = w.ticket(&fighter(), BTC, 1);
    long.deadline_ms = w.now + 60_001;
    let sig = w.sign(&long);
    assert!(fails(|| w.call(&fighter()).start_duel(long, sig)));

    let mut edge = w.ticket(&fighter(), BTC, 1);
    edge.deadline_ms = w.now + 60_000;
    let sig = w.sign(&edge);
    let _ = w.call(&fighter()).start_duel(edge, sig);
}

#[test]
fn zero_seed_hash_and_bot_fighter_fail() {
    let mut w = World::new();
    let mut zero = w.ticket(&fighter(), BTC, 1);
    zero.seed_hash = b64(&[0u8; 32]);
    let sig = w.sign(&zero);
    assert!(fails(|| w.call(&fighter()).start_duel(zero, sig)));

    let as_bot = w.ticket(&bot_account(2), BTC, 1);
    let sig = w.sign(&as_bot);
    assert!(fails(|| w.call(&bot_account(2)).start_duel(as_bot, sig)));
}

#[test]
fn stale_price_or_unknown_asset_fail() {
    let mut w = World::new();
    w.feed_on = false;
    w.advance(T0 + 6_000);
    let ticket = w.ticket(&fighter(), BTC, 1);
    let sig = w.sign(&ticket);
    assert!(fails(|| w.call(&fighter()).start_duel(ticket, sig)));
    let unknown = w.ticket(&fighter(), 9, 1);
    let sig = w.sign(&unknown);
    assert!(fails(|| w.call(&fighter()).start_duel(unknown, sig)));
}

#[test]
fn not_enough_gas() {
    let mut w = World::new();
    let ticket = w.ticket(&fighter(), BTC, 1);
    let sig = w.sign(&ticket);
    ctx_with_gas(&fighter(), w.now, Gas::from_tgas(59));
    assert!(fails(|| w.arena.start_duel(ticket.clone(), sig.clone())));
    // The frontend attaches 100 Tgas. (The mocked fee table charges more for receipts than the chain does, so the
    // exact on-chain floor is measured in the sandbox tests.)
    ctx_with_gas(&fighter(), w.now, Gas::from_tgas(100));
    let _ = w.arena.start_duel(ticket, sig);
}

#[test]
fn duel_already_running() {
    let mut w = World::new();
    // Pending.
    let ticket = w.ticket(&fighter(), BTC, 1);
    let sig = w.sign(&ticket);
    let _ = w.call(&fighter()).start_duel(ticket.clone(), sig);
    let next = w.ticket(&fighter(), BTC, 1);
    let sig = w.sign(&next);
    assert!(fails(|| w
        .call(&fighter())
        .start_duel(next.clone(), sig.clone())));
    // Active.
    w.call(&arena_id()).on_start_duel(ticket, Ok(true));
    assert!(matches!(
        w.arena.active_duel_of(fighter()),
        Some(ActiveSlot::Active { duel_id: 1 })
    ));
    assert!(fails(|| w.call(&fighter()).start_duel(next, sig)));
}

#[test]
fn too_close_to_season_end() {
    let mut w = World::new();
    let end = w.arena.get_season(1).unwrap().end_ms;
    // countdown 5 s + round 30 s + grace 10 s must fit before end_ms.
    w.advance(end - 45_000 + 1);
    let ticket = w.ticket(&fighter(), BTC, 1);
    let sig = w.sign(&ticket);
    assert!(fails(|| w
        .call(&fighter())
        .start_duel(ticket.clone(), sig.clone())));
    w.now = end - 45_000;
    let _ = w.call(&fighter()).start_duel(ticket, sig);
}

#[test]
fn no_season() {
    ctx(&owner(), T0);
    let key = ed25519_dalek::SigningKey::from_bytes(&[7u8; 32]);
    let mut arena = Arena::new(owner(), vault(), public_key(&key), None);
    arena.grant_role(Role::Pusher, pusher());
    arena.add_asset(feed(1), "GOOGL".into());
    arena.set_bot(1, rookie(), true);
    ctx(&pusher(), T0);
    arena.push_ticks(vec![TickInput {
        asset_id: 1,
        price: P,
        expo: EXPO,
        publish_ms: T0,
    }]);
    ctx(&fighter(), T0);
    let ticket = SeedTicket {
        fighter: fighter(),
        asset_id: 1,
        bot_level: 1,
        seed_hash: b64(&[1; 32]),
        nonce: 0,
        deadline_ms: T0 + 1_000,
    };
    let sig = World::sign_with(&key, &ticket, arena_id());
    assert!(fails(|| arena.start_duel(ticket, sig)));
}

// ---------------------------------------------------------------- callback

#[test]
fn eligible_fighter_gets_a_duel() {
    let mut w = World::new();
    let ticket = w.ticket(&fighter(), BTC, 2);
    let sig = w.sign(&ticket);
    let _ = w.call(&fighter()).start_duel(ticket.clone(), sig);
    w.advance(T0 + 1_000);
    let id = w.call(&arena_id()).on_start_duel(ticket, Ok(true));
    assert_eq!(id, Some(1));
    let e = find_event("duel_created").unwrap();
    assert_eq!(e["data"]["duel_id"], 1);
    assert_eq!(e["data"]["bot"], bot_account(2).as_str());
    assert_eq!(e["data"]["start_ms"], T0 + 1_000 + 5_000);
    let d = w.arena.get_duel(1).unwrap();
    assert_eq!(d.start_ms, T0 + 6_000);
    assert_eq!(d.end_ms, T0 + 36_000);
    assert_eq!((d.hp_fighter, d.hp_bot), (1_000, 1_000));
    assert_eq!(d.status, Status::Active);
    assert_eq!(
        (d.season, d.nonce, d.bot_level, d.damage_config_id),
        (1, 0, 2, 1)
    );
    assert_eq!(w.arena.get_config().next_duel_id, 2);
}

#[test]
fn not_eligible() {
    let mut w = World::new();
    assert_eq!(w.start_with(1, Ok(false)), None);
    let e = find_event("duel_rejected").unwrap();
    assert_eq!(e["data"]["reason"], "not_eligible");
    assert_eq!(e["data"]["nonce"], 0);
    assert!(w.arena.active_duel_of(fighter()).is_none());
    assert!(w.arena.get_duel(1).is_none());
    // Free to start again with a new ticket.
    assert_eq!(w.start_with(1, Ok(true)), Some(1));
}

#[test]
fn vault_call_fails() {
    let mut w = World::new();
    assert_eq!(w.start_with(1, Err(PromiseError::Failed)), None);
    assert_eq!(
        find_event("duel_rejected").unwrap()["data"]["reason"],
        "vault_error"
    );
    assert!(w.arena.active_duel_of(fighter()).is_none());
}

#[test]
fn callback_rechecks_pause_staleness_and_season() {
    // Paused between start and callback.
    let mut w = World::new();
    let ticket = w.ticket(&fighter(), BTC, 1);
    let sig = w.sign(&ticket);
    let _ = w.call(&fighter()).start_duel(ticket.clone(), sig);
    w.call(&guardian()).pause();
    w.call(&arena_id()).on_start_duel(ticket, Ok(true));
    assert_eq!(
        find_event("duel_rejected").unwrap()["data"]["reason"],
        "paused"
    );

    // Price went stale.
    let mut w = World::new();
    let ticket = w.ticket(&fighter(), BTC, 1);
    let sig = w.sign(&ticket);
    let _ = w.call(&fighter()).start_duel(ticket.clone(), sig);
    w.feed_on = false;
    w.advance(T0 + 6_000);
    w.call(&arena_id()).on_start_duel(ticket, Ok(true));
    assert_eq!(
        find_event("duel_rejected").unwrap()["data"]["reason"],
        "stale_price"
    );

    // Season ended in between.
    let mut w = World::new();
    let ticket = w.ticket(&fighter(), BTC, 1);
    let sig = w.sign(&ticket);
    let _ = w.call(&fighter()).start_duel(ticket.clone(), sig);
    w.call(&operator()).end_season_now();
    w.call(&arena_id()).on_start_duel(ticket, Ok(true));
    assert_eq!(
        find_event("duel_rejected").unwrap()["data"]["reason"],
        "season_closed"
    );
    assert!(w.arena.active_duel_of(fighter()).is_none());
}

#[test]
fn clear_stale_pending() {
    let mut w = World::new();
    let ticket = w.ticket(&fighter(), BTC, 1);
    let sig = w.sign(&ticket);
    let _ = w.call(&fighter()).start_duel(ticket.clone(), sig);
    w.advance(T0 + 30_000);
    assert!(fails(|| w.call(&stranger()).clear_stale_pending(fighter())));
    w.advance(T0 + 61_000);
    w.call(&stranger()).clear_stale_pending(fighter());
    assert_eq!(
        find_event("duel_rejected").unwrap()["data"]["reason"],
        "pending_timeout"
    );
    assert!(w.arena.active_duel_of(fighter()).is_none());
    assert!(fails(|| w.call(&stranger()).clear_stale_pending(fighter())));

    // A late callback for the cleared ticket changes nothing.
    assert_eq!(w.start_with(1, Ok(true)), Some(1));
    assert_eq!(w.call(&arena_id()).on_start_duel(ticket, Ok(true)), None);
    assert!(matches!(
        w.arena.active_duel_of(fighter()),
        Some(ActiveSlot::Active { duel_id: 1 })
    ));
}

// ---------------------------------------------------------------- open

#[test]
fn open_rules() {
    let mut w = World::new();
    let (id, start) = w.start();
    // Countdown.
    assert!(fails(|| w.open(id, &fighter(), Dir::Long, 1)));
    w.advance(start);
    // Stranger and bad commits.
    assert!(fails(|| w.open(id, &stranger(), Dir::Long, 1)));
    assert!(fails(|| w.call(&fighter()).open_position(
        id,
        b64(&[0; 32]),
        None
    )));
    assert!(fails(|| w.call(&fighter()).open_position(
        id,
        b64(&[1; 31]),
        None
    )));
    assert!(fails(|| w.open(99, &fighter(), Dir::Long, 1)));

    w.open(id, &fighter(), Dir::Long, 1);
    let e = find_event("position_opened").unwrap();
    assert_eq!(e["data"]["side"], "Fighter");
    assert!(e["data"].get("dir").is_none(), "direction stays hidden");
    assert!(
        fails(|| w.open(id, &fighter(), Dir::Long, 2)),
        "already open"
    );
    let p = w.arena.get_position(id, Side::Fighter).unwrap();
    assert!(p.open);
    assert_eq!((p.trades, p.open_ms), (1, start));
    assert_eq!(p.open_tick, w.arena.latest_tick_index(BTC));

    // Bot opens too.
    w.open(id, &rookie(), Dir::Short, 3);
    assert_eq!(
        find_event("position_opened").unwrap()["data"]["side"],
        "Bot"
    );
}

#[test]
fn fifth_trade_fails() {
    let mut w = World::new();
    let (id, start) = w.start();
    let mut t = start;
    for salt in 1..=4 {
        w.advance(t);
        w.open(id, &fighter(), Dir::Long, salt);
        w.advance(t + 3_000);
        w.close(id, &fighter(), Dir::Long, salt);
        t += 3_000;
    }
    assert_eq!(w.arena.get_position(id, Side::Fighter).unwrap().trades, 4);
    assert!(fails(|| w.open(id, &fighter(), Dir::Long, 5)));
}

#[test]
fn open_with_stale_price_fails() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.feed_on = false;
    w.advance(start + 1_000);
    assert!(fails(|| w.open(id, &fighter(), Dir::Long, 1)));
}

#[test]
fn open_at_round_end_fails() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start + 30_000);
    assert!(fails(|| w.open(id, &fighter(), Dir::Long, 1)));
}

// ---------------------------------------------------------------- close

#[test]
fn hold_too_short_and_wrong_salt() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start);
    w.open(id, &fighter(), Dir::Long, 1);
    w.advance(start + 500);
    assert!(fails(|| w.close(id, &fighter(), Dir::Long, 1)));
    w.advance(start + 1_000);
    assert!(
        fails(|| w.close(id, &fighter(), Dir::Long, 2)),
        "wrong salt"
    );
    assert!(
        fails(|| w.close(id, &fighter(), Dir::Short, 1)),
        "wrong direction"
    );
    assert!(
        fails(|| w.close(id, &rookie(), Dir::Long, 1)),
        "bot has no open position"
    );
    w.close(id, &fighter(), Dir::Long, 1);
    assert!(
        fails(|| w.close(id, &fighter(), Dir::Long, 1)),
        "already closed"
    );
}

#[test]
fn profitable_close_damages_the_bot() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start);
    w.open(id, &fighter(), Dir::Long, 1);
    w.advance(start + 5_000);
    // +50 ppm on BTC (×400) = 200 HP.
    w.tick_price(moved(50));
    w.close(id, &fighter(), Dir::Long, 1);
    let e = find_event("position_closed").unwrap();
    assert_eq!(e["data"]["net_pnl_ppm"], 50);
    assert_eq!(e["data"]["opponent_delta"], -200);
    assert_eq!(e["data"]["self_delta"], 0);
    assert_eq!(e["data"]["dir"], "Long");
    let d = w.arena.get_duel(id).unwrap();
    assert_eq!((d.hp_fighter, d.hp_bot), (1_000, 800));
    let p = w.arena.get_position(id, Side::Fighter).unwrap();
    assert_eq!((p.score_ppm, p.damage_dealt, p.open), (50, 200, false));
}

#[test]
fn reveal_in_grace_is_priced_at_round_end() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start + 20_000);
    w.open(id, &fighter(), Dir::Long, 1);
    w.advance(start + 30_000);
    let end_tick = w.arena.latest_tick_index(BTC);
    // The price jumps after the round end; the close must not see it.
    w.tick_price(moved(500));
    w.advance(start + 34_000);
    w.close(id, &fighter(), Dir::Long, 1);
    let e = find_event("position_closed").unwrap();
    assert_eq!(e["data"]["close_tick"], end_tick);
    assert_eq!(e["data"]["net_pnl_ppm"], 0);
    assert_ne!(end_tick, w.arena.latest_tick_index(BTC));
}

#[test]
fn reveal_after_grace_fails() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start + 20_000);
    w.open(id, &fighter(), Dir::Long, 1);
    w.advance(start + 40_000);
    assert!(fails(|| w.close(id, &fighter(), Dir::Long, 1)));
}

#[test]
fn big_loss_during_immunity_keeps_one_hp() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.arena.duels.get_mut(&id).unwrap().hp_fighter = 300;
    w.advance(start);
    w.open(id, &fighter(), Dir::Long, 1);
    w.advance(start + 3_000);
    // -100 ppm on BTC = 400 HP on the Fighter, 3 s into the round.
    w.tick_price(moved(-100));
    w.close(id, &fighter(), Dir::Long, 1);
    let e = find_event("position_closed").unwrap();
    assert_eq!(e["data"]["self_delta"], -400);
    assert_eq!(e["data"]["ko"], false);
    let d = w.arena.get_duel(id).unwrap();
    assert_eq!(d.hp_fighter, 1);
    assert_eq!(d.ko_ms, None);
}

#[test]
fn ko_after_immunity() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.arena.duels.get_mut(&id).unwrap().hp_bot = 350;
    w.advance(start + 2_000);
    w.open(id, &rookie(), Dir::Short, 7);
    w.advance(start + 8_000);
    w.open(id, &fighter(), Dir::Long, 1);
    w.advance(start + 11_000);
    w.tick_price(moved(100));
    assert_eq!(w.now, start + 12_000);
    w.close(id, &fighter(), Dir::Long, 1);
    let e = find_event("position_closed").unwrap();
    assert_eq!(e["data"]["ko"], true);
    assert_eq!(e["data"]["hp_bot"], 0);
    let d = w.arena.get_duel(id).unwrap();
    assert_eq!(d.ko_ms, Some(start + 12_000));
    assert_eq!(d.effective_end_ms, start + 12_000);

    // New opens fail after the KO; the bot can still reveal within the grace window.
    w.advance(start + 13_000);
    assert!(fails(|| w.open(id, &fighter(), Dir::Long, 2)));
    w.advance(start + 21_000);
    w.close(id, &rookie(), Dir::Short, 7);
    // Priced at the KO tick: open at +2 s (price P), close at the KO tick (+100 ppm) => Short loses 100 ppm.
    assert_eq!(
        find_event("position_closed").unwrap()["data"]["net_pnl_ppm"],
        -100
    );

    assert!(
        fails(|| w.call(&stranger()).settle_duel(id)),
        "before ko + 10 s"
    );
    w.advance(start + 22_000);
    w.call(&stranger()).settle_duel(id);
    let e = find_event("duel_finished").unwrap();
    assert_eq!(e["data"]["ko"], true);
    assert_eq!(e["data"]["winner"], fighter().as_str());
    assert_eq!(e["data"]["outcome"], "Win");
}

// ---------------------------------------------------------------- settle

#[test]
fn settle_too_early() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start + 39_999);
    assert!(fails(|| w.call(&stranger()).settle_duel(id)));
    w.advance(start + 40_000);
    w.call(&stranger()).settle_duel(id);
    assert!(
        fails(|| w.call(&stranger()).settle_duel(id)),
        "not active anymore"
    );
}

#[test]
fn fighter_ahead_on_score() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start);
    w.open(id, &fighter(), Dir::Long, 1);
    w.open(id, &rookie(), Dir::Long, 2);
    w.advance(start + 5_000);
    // +25 ppm: Fighter long gains 25 ppm (100 HP on the bot).
    w.tick_price(moved(25));
    w.close(id, &fighter(), Dir::Long, 1);
    // Bot closes at -100 ppm from the open price: -100 ppm (400 HP on itself).
    w.tick_price(moved(-100));
    w.close(id, &rookie(), Dir::Long, 2);
    w.advance(start + 40_000);
    w.call(&stranger()).settle_duel(id);
    let d = w.arena.get_duel(id).unwrap();
    assert_eq!(d.status, Status::Finished);
    assert_eq!(d.outcome, Some(Outcome::Win));
    assert_eq!(d.winner, Some(fighter()));
    assert!(!d.ko);
    assert_eq!(d.settled_ms, Some(start + 40_000));
    assert!(w.arena.active_duel_of(fighter()).is_none());
}

#[test]
fn ko_wins_over_score() {
    let mut w = World::new();
    let (id, start) = w.start();
    {
        let duel = w.arena.duels.get_mut(&id).unwrap();
        duel.hp_bot = 0;
    }
    // The bot is ahead on score.
    w.advance(start);
    w.open(id, &rookie(), Dir::Long, 2);
    w.open(id, &fighter(), Dir::Short, 1);
    w.advance(start + 6_000);
    w.tick_price(moved(1));
    w.close(id, &rookie(), Dir::Long, 2);
    w.close(id, &fighter(), Dir::Short, 1);
    w.advance(start + 40_000);
    w.call(&stranger()).settle_duel(id);
    let d = w.arena.get_duel(id).unwrap();
    assert_eq!(d.winner, Some(fighter()));
    assert_eq!(d.outcome, Some(Outcome::Win));
    assert!(d.ko);
}

#[test]
fn draw_when_everything_is_equal() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start);
    w.open(id, &fighter(), Dir::Long, 1);
    w.open(id, &rookie(), Dir::Long, 2);
    w.advance(start + 5_000);
    w.close(id, &fighter(), Dir::Long, 1);
    w.close(id, &rookie(), Dir::Long, 2);
    w.advance(start + 40_000);
    w.call(&stranger()).settle_duel(id);
    let e = find_event("duel_finished").unwrap();
    assert_eq!(e["data"]["outcome"], "Draw");
    assert_eq!(e["data"]["winner"], Value::Null);
}

#[test]
fn idle_fighter_forfeits() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start + 40_000);
    w.call(&stranger()).settle_duel(id);
    assert_eq!(event_names(), vec!["duel_forfeited"]);
    let d = w.arena.get_duel(id).unwrap();
    assert_eq!(d.status, Status::Forfeited);
    assert_eq!(d.outcome, Some(Outcome::Loss));
    assert_eq!(d.winner, Some(rookie()));
}

#[test]
fn open_positions_are_penalized() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start);
    w.open(id, &fighter(), Dir::Long, 1);
    w.advance(start + 10_000);
    w.tick_price(moved(200));
    w.advance(start + 40_000);
    w.call(&stranger()).settle_duel(id);
    let e = find_event("position_penalized").unwrap();
    // Moved 200 ppm between open and round end: charged -300 ppm, 400 HP (cap) on the Fighter.
    assert_eq!(e["data"]["net_pnl_ppm"], -300);
    assert_eq!(e["data"]["self_delta"], -400);
    let d = w.arena.get_duel(id).unwrap();
    assert_eq!(d.outcome, Some(Outcome::Loss));
    assert_eq!(d.hp_fighter, 600);
    assert!(!w.arena.get_position(id, Side::Fighter).unwrap().open);
}

// ---------------------------------------------------------------- void

#[test]
fn outage_mid_round_voids() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start + 5_000);
    w.feed_on = false;
    w.advance(start + 17_000);
    w.feed_on = true;
    w.advance(start + 18_000);
    w.call(&stranger()).void_duel(id);
    assert_eq!(event_names(), vec!["duel_voided"]);
    let d = w.arena.get_duel(id).unwrap();
    assert_eq!(d.status, Status::Voided);
    assert_eq!(d.settled_ms, Some(start + 18_000));
    assert!(w.arena.active_duel_of(fighter()).is_none());
}

#[test]
fn healthy_feed_cannot_void() {
    let mut w = World::new();
    let (id, start) = w.start();
    assert!(fails(|| w.call(&stranger()).void_duel(id)), "before start");
    w.advance(start + 20_000);
    assert!(fails(|| w.call(&stranger()).void_duel(id)));
    w.advance(start + 40_000);
    assert!(fails(|| w.call(&owner()).void_duel(id)));
}

#[test]
fn settle_voids_on_outage() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.feed_on = false;
    w.advance(start + 40_000);
    w.call(&stranger()).settle_duel(id);
    assert_eq!(event_names(), vec!["duel_voided"]);
}

#[test]
fn ring_overwritten_voids() {
    let mut w = World::with_ring(Some(64));
    let (id, start) = w.start();
    // More than 64 ticks after the round start: no tick at or before start_ms is left in the ring.
    w.advance(start + 50_000);
    w.advance(start + 80_000);
    ctx(&stranger(), w.now);
    assert!(w.arena.try_tick_at(BTC, start).is_none());
    w.call(&stranger()).settle_duel(id);
    assert_eq!(event_names(), vec!["duel_voided"]);
}

// ---------------------------------------------------------------- reveal and prune

#[test]
fn timely_reveal_scores_and_deletes() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start);
    w.open(id, &fighter(), Dir::Long, 1);
    w.advance(start + 5_000);
    w.tick_price(moved(100));
    w.close(id, &fighter(), Dir::Long, 1);
    w.advance(start + 40_000);
    w.call(&stranger()).settle_duel(id);
    assert!(
        fails(|| w.call(&stranger()).prune_duel(id)),
        "reveal window open"
    );
    w.advance(start + 60_000);
    w.call(&stranger())
        .reveal_bot_seed(id, b64(&SEED), Some(b64(&[4u8; 32])));
    let names = event_names();
    assert_eq!(names, vec!["bot_seed_revealed", "result_recorded"]);
    let e = find_event("bot_seed_revealed").unwrap();
    assert_eq!(e["data"]["seed"], serde_json::to_value(b64(&SEED)).unwrap());
    let r = find_event("result_recorded").unwrap();
    // Rookie win by 400 HP (1000 vs 600): 5 + 5 × 400 / 1000 = 7.
    assert_eq!(r["data"]["points"], 7);
    assert_eq!(r["data"]["outcome"], "Win");
    assert!(w.arena.get_duel(id).is_none());
    assert!(w.arena.get_position(id, Side::Fighter).is_none());
    assert!(!w.arena.positions.contains_key(&(id, Side::Fighter)));
    let s = w.arena.score_of(1, fighter());
    assert_eq!((s.points, s.duels, s.wins), (7, 1, 1));
    assert!(fails(|| w.reveal(id)), "duel is gone");
}

#[test]
fn wrong_seed_keeps_the_duel() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start + 40_000);
    w.call(&stranger()).settle_duel(id);
    assert!(fails(|| w.call(&stranger()).reveal_bot_seed(
        id,
        b64(&[1u8; 32]),
        None
    )));
    assert!(fails(|| w.call(&stranger()).reveal_bot_seed(
        id,
        b64(&SEED),
        Some(b64(&[0u8; 65]))
    )));
    assert!(w.arena.get_duel(id).is_some());
}

#[test]
fn reveal_for_a_running_duel_fails() {
    let mut w = World::new();
    let (id, _) = w.start();
    assert!(fails(|| w.reveal(id)));
}

#[test]
fn prune_unrevealed_duel() {
    let mut w = World::new();
    let (id, start) = w.start();
    assert!(fails(|| w.call(&stranger()).prune_duel(id)), "still active");
    w.advance(start + 40_000);
    w.call(&stranger()).settle_duel(id);
    w.advance(start + 40_000 + 600_000);
    assert!(fails(|| w.call(&stranger()).prune_duel(id)));
    w.advance(start + 40_000 + 11 * 60_000);
    w.call(&stranger()).prune_duel(id);
    assert_eq!(event_names(), vec!["duel_pruned"]);
    assert!(w.arena.get_duel(id).is_none());
    assert_eq!(w.arena.score_of(1, fighter()).duels, 0);
    assert!(fails(|| w.call(&stranger()).prune_duel(id)));
}

#[test]
fn many_duels_in_sequence() {
    let mut w = World::new();
    for n in 1..=3u64 {
        let (id, start) = w.start();
        assert_eq!(id, n);
        w.advance(start);
        w.open(id, &fighter(), Dir::Long, 1);
        w.advance(start + 3_000);
        w.close(id, &fighter(), Dir::Long, 1);
        w.advance(start + 40_000);
        w.call(&stranger()).settle_duel(id);
        w.reveal(id);
    }
    assert_eq!(w.arena.score_of(1, fighter()).duels, 3);
    assert_eq!(w.arena.nonce_of(fighter()), 3);
}

// ---------------------------------------------------------------- positions priced at the tick the caller saw

#[test]
fn close_is_priced_at_the_tick_the_caller_picked() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start);
    w.open(id, &fighter(), Dir::Long, 1);
    w.advance(start + 2_000);
    // The caller sees a +50 ppm tick and sends the close; before it lands the price moves on to +100 ppm.
    w.tick_price(moved(50));
    let seen = w.arena.latest_tick_index(BTC);
    w.tick_price(moved(100));
    w.tick_price(moved(100));
    w.close_at(id, &fighter(), Dir::Long, 1, Some(seen));
    let e = find_event("position_closed").unwrap();
    assert_eq!(e["data"]["close_tick"], seen);
    assert_eq!(
        e["data"]["net_pnl_ppm"], 50,
        "the tick seen, not the latest"
    );
    assert_eq!(e["data"]["opponent_delta"], -200);
}

#[test]
fn open_is_priced_at_the_tick_the_caller_picked() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start);
    let seen = w.arena.latest_tick_index(BTC);
    w.advance(start + 2_000);
    w.open_at(id, &fighter(), Dir::Long, 1, Some(seen));
    let p = w.arena.get_position(id, Side::Fighter).unwrap();
    assert_eq!(p.open_tick, seen, "not the latest tick");
    assert!(p.open_tick < w.arena.latest_tick_index(BTC));
}

#[test]
fn a_picked_tick_must_exist_and_be_recent() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start);
    let early = w.arena.latest_tick_index(BTC);
    w.advance(start + 8_000);
    assert!(
        fails(|| w.open_at(id, &fighter(), Dir::Long, 1, Some(early))),
        "older than the lookback"
    );
    let latest = w.arena.latest_tick_index(BTC);
    assert!(
        fails(|| w.open_at(id, &fighter(), Dir::Long, 1, Some(latest + 1))),
        "not pushed yet"
    );
    assert!(fails(|| w.open_at(id, &fighter(), Dir::Long, 1, Some(0))));
    // A recent tick, a few seconds old, is fine.
    w.open_at(id, &fighter(), Dir::Long, 1, Some(latest - 4));
    assert!(w.arena.get_position(id, Side::Fighter).unwrap().open);
}

#[test]
fn a_picked_tick_cannot_predate_the_round() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start + 2_000);
    let before = w.arena.tick_at(BTC, start - 1_000);
    assert!(fails(|| w.open_at(
        id,
        &fighter(),
        Dir::Long,
        1,
        Some(before)
    )));
    let at_start = w.arena.tick_at(BTC, start);
    w.open_at(id, &fighter(), Dir::Long, 1, Some(at_start));
}

#[test]
fn the_hold_is_counted_between_the_picked_ticks() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start);
    let opened = w.arena.latest_tick_index(BTC);
    w.open_at(id, &fighter(), Dir::Long, 1, Some(opened));
    w.advance(start + 3_000);
    assert!(
        fails(|| w.close_at(id, &fighter(), Dir::Long, 1, Some(opened))),
        "same tick: no hold"
    );
    assert!(
        fails(|| w.close_at(id, &fighter(), Dir::Long, 1, Some(opened - 1))),
        "a tick before the open"
    );
    // One second after the open is enough, even though the call lands later.
    w.close_at(id, &fighter(), Dir::Long, 1, Some(opened + 1));
    assert!(!w.arena.get_position(id, Side::Fighter).unwrap().open);
}
