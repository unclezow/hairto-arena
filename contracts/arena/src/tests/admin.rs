//! `arena-admin` scenarios.

use ed25519_dalek::SigningKey;

use super::*;
use crate::damage::DamageConfig;
use crate::types::TickInput;

#[test]
fn init_defaults() {
    let w = World::new();
    ctx(&stranger(), T0);
    let c = w.arena.get_config();
    assert_eq!(c.owner_id, owner());
    assert_eq!(c.vault_id, vault());
    assert!(!c.paused);
    assert_eq!(c.countdown_ms, 5_000);
    assert_eq!(c.ko_immunity_ms, 5_000);
    assert_eq!(c.max_staleness_ms, 5_000);
    assert_eq!(c.ring_size, 1_024);
    assert_eq!(c.active_damage_config, 1);
    assert_eq!(c.next_duel_id, 1);
    assert_eq!(
        w.arena.get_damage_config(1),
        Some(DamageConfig::AssetScaled {
            paper_cost_ppm: 0,
            default_hp_per_bps: 450,
            max_hit_hp: 400,
            hp_per_bps: vec![(1, 600), (2, 400), (3, 1_500)],
        })
    );
    let d = w.arena.get_durations();
    assert_eq!(d.season_duration_ms, 7 * 24 * 3_600_000);
    assert_eq!(d.pick_window_ms, 24 * 3_600_000);
    assert_eq!(d.dispute_window_ms, 3_600_000);
    assert_eq!(d.close_delay_ms, 15 * 60_000);
    assert_eq!(d.claim_period_ms, 30 * 24 * 3_600_000);
    assert_eq!(w.arena.bot_service_key(), public_key(&w.key));
    assert!(
        w.arena.get_bot(4).is_none(),
        "no level configured at init beyond the fixture"
    );
}

#[test]
fn ring_size_out_of_range() {
    ctx(&owner(), T0);
    let key = public_key(&SigningKey::from_bytes(&[1; 32]));
    assert!(fails(|| Arena::new(
        owner(),
        vault(),
        key.clone(),
        Some(10)
    )));
    assert!(fails(|| Arena::new(
        owner(),
        vault(),
        key.clone(),
        Some(8_193)
    )));
    assert!(!fails(|| Arena::new(owner(), vault(), key, Some(64))));
}

#[test]
fn grant_pusher_emits_and_enables_push() {
    let mut w = World::new();
    let new_pusher = acc("pusher2.test.near");
    w.call(&owner())
        .grant_role(Role::Pusher, new_pusher.clone());
    let e = find_event("role_changed").unwrap();
    assert_eq!(e["standard"], "hairto");
    assert_eq!(e["version"], "1.0.0");
    assert_eq!(e["data"]["role"], "Pusher");
    assert_eq!(e["data"]["account_id"], new_pusher.as_str());
    assert_eq!(e["data"]["granted"], true);
    w.call(&new_pusher).push_ticks(vec![TickInput {
        asset_id: 1,
        price: 1,
        expo: 0,
        publish_ms: T0,
    }]);
    assert!(w.arena.has_role(Role::Pusher, new_pusher.clone()));

    w.call(&owner())
        .revoke_role(Role::Pusher, new_pusher.clone());
    assert!(!w.arena.has_role(Role::Pusher, new_pusher.clone()));
    assert!(fails(|| w.call(&new_pusher).push_ticks(vec![])));
}

#[test]
fn non_owner_cannot_grant() {
    let mut w = World::new();
    assert!(fails(|| w
        .call(&stranger())
        .grant_role(Role::Operator, stranger())));
    assert!(fails(|| w.call(&guardian()).transfer_ownership(guardian())));
}

#[test]
fn owner_holds_no_role_implicitly() {
    let mut w = World::new();
    assert!(fails(|| w.call(&owner()).pause()));
    assert!(fails(|| w.call(&owner()).start_season(vec![])));
    assert!(fails(|| w.call(&owner()).push_ticks(vec![])));
}

#[test]
fn transfer_ownership() {
    let mut w = World::new();
    let next = acc("council.test.near");
    w.call(&owner()).transfer_ownership(next.clone());
    let e = find_event("role_changed").unwrap();
    assert_eq!(e["data"]["role"], Value::Null);
    assert_eq!(w.arena.owner_id(), next);
    assert!(fails(|| w.call(&owner()).set_params(
        Some(2_000),
        None,
        None
    )));
    w.call(&next).set_params(Some(2_000), None, None);
}

#[test]
fn pause_mid_duel_stops_only_new_duels() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.advance(start);
    w.open(id, &fighter(), Dir::Long, 1);
    w.call(&guardian()).pause();
    assert_eq!(event_names(), vec!["paused"]);
    assert!(w.arena.is_paused());

    w.advance(start + 4_000);
    w.close(id, &fighter(), Dir::Long, 1);
    w.advance(start + 40_000);
    w.call(&stranger()).settle_duel(id);
    assert!(w.arena.get_duel(id).unwrap().status.is_terminal());

    let ticket = w.ticket(&fighter(), BTC, 1);
    let sig = w.sign(&ticket);
    assert!(fails(|| w
        .call(&fighter())
        .start_duel(ticket.clone(), sig.clone())));
    w.reveal(id);
    w.call(&guardian()).unpause();
    assert_eq!(event_names(), vec!["unpaused"]);
}

#[test]
fn bounded_parameters() {
    let mut w = World::new();
    assert!(fails(|| w.call(&owner()).set_params(
        Some(20_000),
        None,
        None
    )));
    assert!(fails(|| w.call(&owner()).set_params(Some(999), None, None)));
    assert!(fails(|| w.call(&owner()).set_params(
        None,
        Some(20_001),
        None
    )));
    assert!(fails(|| w.call(&owner()).set_params(None, None, Some(999))));
    assert!(fails(|| w.call(&owner()).set_params(
        None,
        None,
        Some(30_001)
    )));
    assert!(fails(|| w.call(&stranger()).set_params(
        Some(2_000),
        None,
        None
    )));

    w.call(&owner())
        .set_params(Some(15_000), Some(0), Some(30_000));
    let e = find_event("params_updated").unwrap();
    assert_eq!(e["data"]["params"]["countdown_ms"], 15_000);
    let c = w.arena.get_config();
    assert_eq!(
        (c.countdown_ms, c.ko_immunity_ms, c.max_staleness_ms),
        (15_000, 0, 30_000)
    );
}

#[test]
fn parameters_apply_to_later_duels() {
    let mut w = World::new();
    let (id, start) = w.start();
    w.call(&owner()).set_params(Some(2_000), Some(10_000), None);
    let duel = w.arena.get_duel(id).unwrap();
    assert_eq!(duel.ko_immunity_ms, 5_000);
    assert_eq!(start, duel.start_ms);
}

#[test]
fn first_asset_gets_id_one() {
    ctx(&owner(), T0);
    let mut arena = Arena::new(
        owner(),
        vault(),
        public_key(&SigningKey::from_bytes(&[1; 32])),
        None,
    );
    let id = arena.add_asset(feed(0xaa), "GOOGL".into());
    assert_eq!(id, 1);
    let e = find_event("asset_added").unwrap();
    assert_eq!(e["data"]["asset_id"], 1);
    assert_eq!(e["data"]["feed_id"], feed(0xaa));
    let a = arena.get_asset(1).unwrap();
    assert!(a.active);
    assert_eq!(a.symbol, "GOOGL");
    assert!(arena.get_asset(0).is_none());
    assert!(!arena.is_tradable(0));
    assert!(!arena.is_tradable(2));
}

#[test]
fn invalid_assets_fail() {
    let mut w = World::new();
    assert!(fails(|| w.call(&owner()).add_asset(feed(0), "ZERO".into())));
    assert!(fails(|| w.call(&owner()).add_asset(feed(1), "DUP".into())));
    assert!(fails(|| w
        .call(&owner())
        .add_asset("abc".into(), "SHORT".into())));
    assert!(fails(|| w
        .call(&owner())
        .add_asset("zz".repeat(32), "HEX".into())));
    assert!(fails(|| w.call(&owner()).add_asset(feed(9), "".into())));
    assert!(fails(|| w
        .call(&owner())
        .add_asset(feed(9), "X".repeat(17))));
    assert!(fails(|| w
        .call(&stranger())
        .add_asset(feed(9), "ETH".into())));
    assert!(fails(|| w.call(&owner()).set_asset_active(9, false)));
    // Upper-case hex is accepted and normalized.
    let id = w
        .call(&owner())
        .add_asset(format!("{:064X}", 0xabu8), "ETH".into());
    assert_eq!(w.arena.get_asset(id).unwrap().feed_id, feed(0xab));
    assert_eq!(w.arena.get_assets().len(), 4);
}

#[test]
fn deactivated_asset_rejects_ticks_and_duels() {
    let mut w = World::new();
    w.call(&owner()).set_asset_active(BTC, false);
    assert_eq!(event_names(), vec!["asset_status_changed"]);
    assert!(!w.arena.is_tradable(BTC));
    let now = w.now;
    assert!(fails(|| w.call(&pusher()).push_ticks(vec![TickInput {
        asset_id: BTC,
        price: P,
        expo: EXPO,
        publish_ms: now,
    }])));
    let ticket = w.ticket(&fighter(), BTC, 1);
    let sig = w.sign(&ticket);
    assert!(fails(|| w
        .call(&fighter())
        .start_duel(ticket.clone(), sig.clone())));
    w.call(&owner()).set_asset_active(BTC, true);
    let _ = w.call(&fighter()).start_duel(ticket, sig);
}

#[test]
fn level_four_not_configured() {
    let mut w = World::new();
    let ticket = w.ticket(&fighter(), BTC, 4);
    let sig = w.sign(&ticket);
    assert!(fails(|| w.call(&fighter()).start_duel(ticket, sig)));
}

#[test]
fn oracle_level_accepts_duels_once_configured() {
    let mut w = World::new();
    w.call(&owner()).set_bot(4, bot_account(4), true);
    let id = w.start_with(4, Ok(true)).unwrap();
    assert_eq!(w.arena.get_duel(id).unwrap().bot, bot_account(4));
}

#[test]
fn configure_trend() {
    let mut w = World::new();
    let trend = acc("trend2.bots.test.near");
    w.call(&owner()).set_bot(2, trend.clone(), true);
    let e = find_event("bot_configured").unwrap();
    assert_eq!(e["data"]["level"], 2);
    let bot = w.arena.get_bot(2).unwrap();
    assert_eq!(bot.account_id, trend);
    assert!(bot.active);
    // The replaced account no longer counts as a bot.
    assert_eq!(w.arena.bot_level_of(bot_account(2)), None);
    assert_eq!(w.arena.bot_level_of(trend), Some(2));
    assert_eq!(w.arena.get_bots().len(), 3);
}

#[test]
fn disable_level_keeps_running_duels() {
    let mut w = World::new();
    let id = w.start_with(3, Ok(true)).unwrap();
    w.call(&owner()).set_bot_active(3, false);
    assert!(!w.arena.get_bot(3).unwrap().active);
    let ticket = w.ticket(&acc("other.test.near"), BTC, 3);
    let sig = w.sign(&ticket);
    assert!(fails(|| w
        .call(&acc("other.test.near"))
        .start_duel(ticket, sig)));
    let start = w.arena.get_duel(id).unwrap().start_ms;
    w.advance(start);
    w.open(id, &bot_account(3), Dir::Short, 2);
}

#[test]
fn invalid_bot_configuration_fails() {
    let mut w = World::new();
    assert!(fails(|| w.call(&owner()).set_bot(
        0,
        acc("x.test.near"),
        true
    )));
    assert!(fails(|| w.call(&owner()).set_bot(
        5,
        acc("x.test.near"),
        true
    )));
    assert!(fails(|| w.call(&owner()).set_bot(4, arena_id(), true)));
    assert!(fails(|| w.call(&owner()).set_bot(4, bot_account(1), true)));
    assert!(fails(|| w.call(&owner()).set_bot_active(4, true)));
    assert!(fails(|| w.call(&stranger()).set_bot(
        4,
        acc("x.test.near"),
        true
    )));
    // Re-binding the same account to the same level is fine.
    w.call(&owner()).set_bot(1, bot_account(1), false);
    assert!(!w.arena.get_bot(1).unwrap().active);
}

#[test]
fn rotate_bot_service_key() {
    let mut w = World::new();
    let old = w.ticket(&fighter(), BTC, 1);
    let old_sig = w.sign(&old);
    let new_key = SigningKey::from_bytes(&[8u8; 32]);
    w.call(&owner()).set_bot_service_key(public_key(&new_key));
    assert_eq!(w.arena.bot_service_key(), public_key(&new_key));
    assert!(fails(|| w
        .call(&fighter())
        .start_duel(old.clone(), old_sig)));
    let new_sig = World::sign_with(&new_key, &old, arena_id());
    let _ = w.call(&fighter()).start_duel(old, new_sig);
}

#[test]
fn non_ed25519_key_fails() {
    let mut w = World::new();
    let secp = PublicKey::from_parts(CurveType::SECP256K1, vec![1u8; 64]).unwrap();
    assert!(fails(|| w.call(&owner()).set_bot_service_key(secp.clone())));
    ctx(&owner(), T0);
    assert!(fails(|| Arena::new(owner(), vault(), secp, None)));
}

#[test]
fn vault_id_setter() {
    let mut w = World::new();
    assert!(fails(|| w.call(&stranger()).set_vault_id(stranger())));
    w.call(&owner()).set_vault_id(acc("vault2.test.near"));
    assert_eq!(w.arena.vault_id(), acc("vault2.test.near"));
}

#[test]
fn damage_config_management() {
    let mut w = World::new();
    let alt = DamageConfig::PnlDifference {
        ppm_per_hp: 10,
        paper_cost_ppm: 0,
    };
    assert!(fails(|| w.call(&stranger()).add_damage_config(alt.clone())));
    let id = w.call(&owner()).add_damage_config(alt.clone());
    assert_eq!(id, 2);
    assert_eq!(event_names(), vec!["damage_config_added"]);
    assert_eq!(
        w.arena.active_damage_config_id(),
        1,
        "adding does not activate"
    );
    assert!(fails(|| w.call(&owner()).activate_damage_config(3)));
    assert!(fails(|| w.call(&owner()).activate_damage_config(0)));

    // Activate during a duel: the running duel keeps configuration 1.
    let (running, _) = w.start();
    w.call(&owner()).activate_damage_config(2);
    assert_eq!(event_names(), vec!["damage_config_activated"]);
    assert_eq!(w.arena.get_duel(running).unwrap().damage_config_id, 1);
    let start = w.arena.get_duel(running).unwrap().start_ms;
    w.advance(start + 40_000);
    w.call(&stranger()).settle_duel(running);
    w.reveal(running);
    let (next, _) = w.start();
    assert_eq!(w.arena.get_duel(next).unwrap().damage_config_id, 2);
    assert_eq!(w.arena.get_damage_config(2), Some(alt));
    assert_eq!(w.arena.damage_config_count(), 2);
}

#[test]
fn invalid_damage_configs_fail() {
    let mut w = World::new();
    let bad = [
        DamageConfig::PnlDifference {
            ppm_per_hp: 0,
            paper_cost_ppm: 0,
        },
        DamageConfig::PnlDifference {
            ppm_per_hp: 10,
            paper_cost_ppm: -1,
        },
        DamageConfig::AssetScaled {
            paper_cost_ppm: -1,
            default_hp_per_bps: 450,
            max_hit_hp: 400,
            hp_per_bps: vec![],
        },
        DamageConfig::AssetScaled {
            paper_cost_ppm: 0,
            default_hp_per_bps: 0,
            max_hit_hp: 400,
            hp_per_bps: vec![],
        },
        DamageConfig::AssetScaled {
            paper_cost_ppm: 0,
            default_hp_per_bps: 450,
            max_hit_hp: 0,
            hp_per_bps: vec![],
        },
        DamageConfig::AssetScaled {
            paper_cost_ppm: 0,
            default_hp_per_bps: 450,
            max_hit_hp: 1_001,
            hp_per_bps: vec![],
        },
        DamageConfig::AssetScaled {
            paper_cost_ppm: 0,
            default_hp_per_bps: 450,
            max_hit_hp: 400,
            hp_per_bps: vec![(1, 0)],
        },
        DamageConfig::AssetScaled {
            paper_cost_ppm: 0,
            default_hp_per_bps: 450,
            max_hit_hp: 400,
            hp_per_bps: vec![(1, 5), (1, 6)],
        },
    ];
    for config in bad {
        assert!(
            fails(|| w.call(&owner()).add_damage_config(config.clone())),
            "{config:?}"
        );
    }
}

#[test]
fn read_views_need_no_role() {
    let mut w = World::new();
    let arena = w.call(&stranger());
    let c = arena.get_config();
    assert_eq!(c.current_season, 1);
    let roles = arena.get_roles();
    assert_eq!(roles.guardians, vec![guardian()]);
    assert_eq!(roles.operators, vec![operator()]);
    assert_eq!(roles.pushers, vec![pusher()]);
    assert_eq!(arena.get_assets().len(), 3);
    assert_eq!(arena.get_bots().len(), 3);
    assert_eq!(arena.vault_id(), vault());
}

#[test]
fn keeper_role() {
    let mut w = World::new();
    let keeper = acc("keeper.test.near");
    assert!(fails(|| w
        .call(&stranger())
        .grant_role(Role::Keeper, keeper.clone())));
    w.call(&owner()).grant_role(Role::Keeper, keeper.clone());
    let e = find_event("role_changed").unwrap();
    assert_eq!(e["data"]["role"], "Keeper");
    assert!(w.arena.has_role(Role::Keeper, keeper.clone()));
    assert_eq!(w.arena.get_roles().keepers, vec![keeper.clone()]);
    w.call(&owner()).revoke_role(Role::Keeper, keeper.clone());
    assert!(!w.arena.has_role(Role::Keeper, keeper));
}

#[test]
fn claims_pause_is_separate_from_duel_pause() {
    let mut w = World::new();
    assert!(fails(|| w.call(&owner()).pause_claims()));
    w.call(&guardian()).pause_claims();
    assert_eq!(event_names(), vec!["claims_paused"]);
    let c = w.arena.get_config();
    assert!(c.claims_paused && !c.paused);
    // Duels still start while claims are paused.
    assert!(w.start_with(1, Ok(true)).is_some());
    w.call(&guardian()).unpause_claims();
    assert_eq!(event_names(), vec!["claims_unpaused"]);
    assert!(!w.arena.get_config().claims_paused);
    assert_eq!(w.arena.get_config().token_id, None);
    assert_eq!(w.arena.get_config().total_pots.0, 0);
}
