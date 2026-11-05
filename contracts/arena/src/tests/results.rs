//! `season-results` and `season-claims` scenarios.

use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{PromiseOrValue, PromiseResult, RuntimeFeesConfig};

use super::*;
use crate::merkle::{leaf_hash, tree};
use crate::types::{ClaimKind, Hash32, Phase, SeasonId};

const USDC: u128 = 1_000_000;
const HOUR: u64 = 3_600_000;
const DAY: u64 = 24 * HOUR;

fn usdc() -> AccountId {
    acc("usdc.test.near")
}
fn keeper() -> AccountId {
    acc("keeper.test.near")
}

fn fund(w: &mut World, amount: u128) {
    match w
        .call(&usdc())
        .ft_on_transfer(vault(), U128(amount), "fund_pot".into())
    {
        PromiseOrValue::Value(unused) => assert_eq!(unused.0, 0),
        PromiseOrValue::Promise(_) => panic!(),
    }
}

/// Season 1 closed now with `pot` in its pot; token set, keeper granted, feed off.
fn closed_world(pot: u128) -> World {
    let mut w = World::new();
    w.feed_on = false;
    w.call(&owner()).set_token_id(usdc());
    w.call(&owner()).grant_role(Role::Keeper, keeper());
    fund(&mut w, pot);
    w.call(&operator()).end_season_now();
    w.call(&stranger()).close_season();
    w
}

struct Payouts {
    tree: Option<tree::Tree>,
    entries: Vec<(AccountId, u128)>,
}

impl Payouts {
    fn new(entries: Vec<(AccountId, u128)>) -> Self {
        let tree = (!entries.is_empty()).then(|| {
            tree::build(
                entries
                    .iter()
                    .map(|(a, v)| leaf_hash(a.as_str(), *v))
                    .collect(),
            )
        });
        Payouts { tree, entries }
    }
    fn root(&self) -> Hash32 {
        self.tree.as_ref().map(|t| t.root()).unwrap_or([0; 32])
    }
    fn total(&self) -> u128 {
        self.entries.iter().map(|(_, v)| v).sum()
    }
    fn proof(&self, account: &AccountId, amount: u128) -> Vec<Base64VecU8> {
        let t = self.tree.as_ref().unwrap();
        t.proof(&leaf_hash(account.as_str(), amount))
            .iter()
            .map(|h| b64(h))
            .collect()
    }
}

fn post(w: &mut World, season: SeasonId, prize: &Payouts, bonus: &Payouts) {
    w.call(&keeper()).post_results(
        season,
        b64(&prize.root()),
        b64(&bonus.root()),
        U128(prize.total()),
        U128(bonus.total()),
    );
}

fn claim(
    w: &mut World,
    kind: ClaimKind,
    who: &AccountId,
    p: &Payouts,
    amount: u128,
    season: SeasonId,
) {
    let proof = p.proof(who, amount);
    let arena = w.call(who);
    let _ = match kind {
        ClaimKind::Prize => arena.claim_prize(season, U128(amount), proof),
        ClaimKind::Bonus => arena.claim_bonus(season, U128(amount), proof),
    };
}

/// The claim transfer callback with a simulated result.
fn transfer_result(
    w: &mut World,
    ok: bool,
    season: SeasonId,
    kind: ClaimKind,
    who: &AccountId,
    amount: u128,
) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(arena_id())
        .predecessor_account_id(arena_id())
        .block_timestamp(w.now * 1_000_000);
    let result = if ok {
        PromiseResult::Successful(vec![])
    } else {
        PromiseResult::Failed
    };
    near_sdk::testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
    w.arena
        .on_claim_transferred(season, kind, who.clone(), U128(amount));
}

fn f1() -> AccountId {
    acc("fighter1.test.near")
}
fn f2() -> AccountId {
    acc("fighter2.test.near")
}
fn b1() -> AccountId {
    acc("backer1.test.near")
}

fn standard() -> (Payouts, Payouts) {
    // Pot 100 USDC: prizes 70 (50 + 20), bonuses 25.
    (
        Payouts::new(vec![(f1(), 50 * USDC), (f2(), 20 * USDC)]),
        Payouts::new(vec![(b1(), 25 * USDC)]),
    )
}

fn phase(w: &mut World, season: SeasonId) -> Phase {
    w.call(&stranger()).get_season(season).unwrap().phase
}

// ================================================================ season-results

#[test]
fn valid_post() {
    let mut w = closed_world(100 * USDC);
    let (prize, bonus) = standard();
    post(&mut w, 1, &prize, &bonus);
    let e = find_event("results_posted").unwrap();
    assert_eq!(e["data"]["prize_total"], (70 * USDC).to_string());
    assert_eq!(e["data"]["claim_opens_ms"], w.now + HOUR);
    assert_eq!(phase(&mut w, 1), Phase::ResultsPosted);
    let r = w.arena.get_season(1).unwrap().results.unwrap();
    assert_eq!(
        (r.claim_opens_ms, r.pot_at_post.0),
        (w.now + HOUR, 100 * USDC)
    );
    assert!(
        fails(|| post(&mut w, 1, &prize, &bonus)),
        "not Closed any more"
    );
}

#[test]
fn caps_and_gates() {
    let mut w = closed_world(100 * USDC);
    let over_prize = Payouts::new(vec![(f1(), 75 * USDC + 1)]);
    let over_bonus = Payouts::new(vec![(b1(), 25 * USDC + 1)]);
    let none = Payouts::new(vec![]);
    assert!(
        fails(|| post(&mut w, 1, &over_prize, &none)),
        "prize above 75%"
    );
    assert!(
        fails(|| post(&mut w, 1, &none, &over_bonus)),
        "bonus above 25%"
    );
    let (prize, bonus) = standard();
    assert!(
        fails(|| w.call(&stranger()).post_results(
            1,
            b64(&prize.root()),
            b64(&[0; 32]),
            U128(prize.total()),
            U128(0)
        )),
        "not a keeper"
    );
    assert!(fails(|| post(&mut w, 9, &prize, &bonus)), "unknown season");
    // Exactly at the caps is fine.
    let full_prize = Payouts::new(vec![(f1(), 75 * USDC)]);
    let full_bonus = Payouts::new(vec![(b1(), 25 * USDC)]);
    post(&mut w, 1, &full_prize, &full_bonus);
}

#[test]
fn season_not_closed() {
    let mut w = World::new();
    w.call(&owner()).grant_role(Role::Keeper, keeper());
    let (prize, bonus) = standard();
    assert!(fails(|| post(&mut w, 1, &prize, &bonus)));
}

#[test]
fn zero_root_rule() {
    let mut w = closed_world(100 * USDC);
    let (prize, _) = standard();
    // Root without total, total without root.
    assert!(fails(|| w.call(&keeper()).post_results(
        1,
        b64(&prize.root()),
        b64(&[0; 32]),
        U128(0),
        U128(0)
    )));
    assert!(fails(|| w.call(&keeper()).post_results(
        1,
        b64(&[0; 32]),
        b64(&[0; 32]),
        U128(1),
        U128(0)
    )));
    // No eligible Fighters or Backers: the whole pot is left for rollover.
    let none = Payouts::new(vec![]);
    post(&mut w, 1, &none, &none);
    assert_eq!(phase(&mut w, 1), Phase::ResultsPosted);
}

#[test]
fn guardian_rejects_in_the_window() {
    let mut w = closed_world(100 * USDC);
    let (prize, bonus) = standard();
    post(&mut w, 1, &prize, &bonus);
    w.now += 10 * 60_000;
    assert!(
        fails(|| w.call(&keeper()).reject_results(1)),
        "guardian only"
    );
    w.call(&guardian()).reject_results(1);
    assert_eq!(event_names(), vec!["results_rejected"]);
    assert_eq!(phase(&mut w, 1), Phase::Closed);
    assert!(w.arena.get_season(1).unwrap().results.is_none());
    post(&mut w, 1, &prize, &bonus);
}

#[test]
fn reject_too_late() {
    let mut w = closed_world(100 * USDC);
    let (prize, bonus) = standard();
    post(&mut w, 1, &prize, &bonus);
    w.now += HOUR;
    assert_eq!(phase(&mut w, 1), Phase::Finalized);
    assert!(fails(|| w.call(&guardian()).reject_results(1)));
}

// ================================================================ season-claims

fn finalized_world() -> (World, Payouts, Payouts) {
    let mut w = closed_world(100 * USDC);
    let (prize, bonus) = standard();
    post(&mut w, 1, &prize, &bonus);
    w.now += HOUR;
    (w, prize, bonus)
}

#[test]
fn fighter_claims() {
    let (mut w, prize, _) = finalized_world();
    claim(&mut w, ClaimKind::Prize, &f1(), &prize, 50 * USDC, 1);
    let e = find_event("prize_claimed").unwrap();
    assert_eq!(e["data"]["amount"], (50 * USDC).to_string());
    let receipts = near_sdk::test_utils::get_created_receipts();
    assert_eq!(receipts[0].receiver_id, usdc());
    assert_eq!(receipts[1].receiver_id, arena_id());
    assert!(w.arena.is_claimed(1, ClaimKind::Prize, f1()));
    assert!(!w.arena.is_claimed(1, ClaimKind::Bonus, f1()));
    assert_eq!(w.arena.pot_of(1), U128(50 * USDC));
    assert_eq!(w.arena.total_pots(), U128(50 * USDC));
    transfer_result(&mut w, true, 1, ClaimKind::Prize, &f1(), 50 * USDC);
    assert!(w.arena.is_claimed(1, ClaimKind::Prize, f1()));
    assert_eq!(
        w.arena
            .get_season(1)
            .unwrap()
            .results
            .unwrap()
            .prize_claimed,
        U128(50 * USDC)
    );
}

#[test]
fn claim_failures() {
    let (mut w, prize, bonus) = finalized_world();
    claim(&mut w, ClaimKind::Prize, &f1(), &prize, 50 * USDC, 1);
    assert!(
        fails(|| claim(&mut w, ClaimKind::Prize, &f1(), &prize, 50 * USDC, 1)),
        "double claim"
    );
    // Wrong amount.
    let proof = bonus.proof(&b1(), 25 * USDC);
    assert!(fails(|| w.call(&b1()).claim_bonus(
        1,
        U128(24 * USDC),
        proof.clone()
    )));
    // Someone else's leaf.
    assert!(fails(|| w.call(&f2()).claim_bonus(
        1,
        U128(25 * USDC),
        proof.clone()
    )));
    // Prize proof used for the bonus root.
    assert!(fails(|| w.call(&f2()).claim_bonus(
        1,
        U128(20 * USDC),
        prize.proof(&f2(), 20 * USDC)
    )));
    assert!(
        fails(|| w.call(&b1()).claim_bonus(2, U128(25 * USDC), proof.clone())),
        "other season"
    );
    w.call(&b1())
        .claim_bonus(1, U128(25 * USDC), proof)
        .detach();
    assert!(find_event("bonus_claimed").is_some());
}

#[test]
fn claims_during_the_dispute_window_fail() {
    let mut w = closed_world(100 * USDC);
    let (prize, bonus) = standard();
    post(&mut w, 1, &prize, &bonus);
    w.now += HOUR - 1;
    assert!(fails(|| claim(
        &mut w,
        ClaimKind::Prize,
        &f1(),
        &prize,
        50 * USDC,
        1
    )));
}

#[test]
fn claims_pause() {
    let (mut w, prize, _) = finalized_world();
    w.call(&guardian()).pause_claims();
    assert!(fails(|| claim(
        &mut w,
        ClaimKind::Prize,
        &f1(),
        &prize,
        50 * USDC,
        1
    )));
    w.call(&guardian()).unpause_claims();
    claim(&mut w, ClaimKind::Prize, &f1(), &prize, 50 * USDC, 1);
}

#[test]
fn claim_needs_gas() {
    let (mut w, prize, _) = finalized_world();
    ctx_with_gas(&f1(), w.now, Gas::from_tgas(29));
    let proof = prize.proof(&f1(), 50 * USDC);
    assert!(fails(|| w.arena.claim_prize(1, U128(50 * USDC), proof)));
}

#[test]
fn failed_transfer_reverses_the_claim() {
    let (mut w, _, bonus) = finalized_world();
    claim(&mut w, ClaimKind::Bonus, &b1(), &bonus, 25 * USDC, 1);
    transfer_result(&mut w, false, 1, ClaimKind::Bonus, &b1(), 25 * USDC);
    let e = find_event("claim_failed").unwrap();
    assert_eq!(e["data"]["credited_season"], 1);
    assert!(!w.arena.is_claimed(1, ClaimKind::Bonus, b1()));
    assert_eq!(w.arena.pot_of(1), U128(100 * USDC));
    assert_eq!(w.arena.total_pots(), U128(100 * USDC));
    assert_eq!(
        w.arena
            .get_season(1)
            .unwrap()
            .results
            .unwrap()
            .bonus_claimed,
        U128(0)
    );
    // After registering with USDC the Backer claims again.
    claim(&mut w, ClaimKind::Bonus, &b1(), &bonus, 25 * USDC, 1);
    assert!(w.arena.is_claimed(1, ClaimKind::Bonus, b1()));
}

/// Season 1 finalized with these results; season 2 started and closed; season 3 Active.
fn three_seasons(pot: u128, prize: Payouts, bonus: Payouts) -> (World, Payouts, Payouts) {
    let (mut w, prize, bonus) = {
        let mut w = closed_world(pot);
        post(&mut w, 1, &prize, &bonus);
        w.now += HOUR;
        (w, prize, bonus)
    };
    w.call(&operator()).start_season(vec![1]);
    w.call(&operator()).end_season_now();
    w.call(&stranger()).close_season();
    w.call(&operator()).start_season(vec![1]);
    w.now += 2 * DAY;
    assert_eq!(phase(&mut w, 3), Phase::Active);
    (w, prize, bonus)
}

#[test]
fn rollover_after_the_claim_period() {
    // Pot 100 USDC: claim 50 + 23.8 + 25 = 98.8, leaving 1.2 USDC.
    let prize = Payouts::new(vec![(f1(), 50 * USDC), (f2(), 23_800_000)]);
    let bonus = Payouts::new(vec![(b1(), 25 * USDC)]);
    let (mut w, prize, bonus) = three_seasons(100 * USDC, prize, bonus);
    claim(&mut w, ClaimKind::Prize, &f1(), &prize, 50 * USDC, 1);
    claim(&mut w, ClaimKind::Prize, &f2(), &prize, 23_800_000, 1);
    claim(&mut w, ClaimKind::Bonus, &b1(), &bonus, 25 * USDC, 1);
    assert_eq!(w.arena.pot_of(1), U128(1_200_000));
    assert!(
        fails(|| w.call(&stranger()).rollover_unclaimed(1)),
        "too early"
    );
    let opens = w
        .arena
        .get_season(1)
        .unwrap()
        .results
        .unwrap()
        .claim_opens_ms;
    w.now = opens + 30 * DAY;
    w.call(&stranger()).rollover_unclaimed(1);
    let e = find_event("season_rolled_over").unwrap();
    assert_eq!(
        (
            e["data"]["from_season"].as_u64(),
            e["data"]["to_season"].as_u64()
        ),
        (Some(1), Some(3))
    );
    assert_eq!(e["data"]["amount"], "1200000");
    assert_eq!(w.arena.pot_of(1), U128(0));
    assert_eq!(w.arena.pot_of(3), U128(1_200_000));
    assert!(w.arena.get_season(1).unwrap().results.unwrap().rolled_over);
    assert!(
        fails(|| w.call(&stranger()).rollover_unclaimed(1)),
        "only once"
    );
}

#[test]
fn claims_after_rollover_fail_and_late_failures_go_to_the_funding_season() {
    let (prize, bonus) = standard();
    let (mut w, prize, bonus) = three_seasons(100 * USDC, prize, bonus);
    claim(&mut w, ClaimKind::Bonus, &b1(), &bonus, 25 * USDC, 1);
    let opens = w
        .arena
        .get_season(1)
        .unwrap()
        .results
        .unwrap()
        .claim_opens_ms;
    w.now = opens + 30 * DAY;
    w.call(&stranger()).rollover_unclaimed(1);
    assert_eq!(w.arena.pot_of(3), U128(75 * USDC));
    assert!(fails(|| claim(
        &mut w,
        ClaimKind::Prize,
        &f1(),
        &prize,
        50 * USDC,
        1
    )));
    // The in-flight bonus transfer fails after the rollover: the money goes to the funding season.
    transfer_result(&mut w, false, 1, ClaimKind::Bonus, &b1(), 25 * USDC);
    assert_eq!(
        find_event("claim_failed").unwrap()["data"]["credited_season"],
        3
    );
    assert_eq!(w.arena.pot_of(1), U128(0));
    assert_eq!(w.arena.pot_of(3), U128(100 * USDC));
    assert_eq!(w.arena.total_pots(), U128(100 * USDC));
}

#[test]
fn rollover_needs_finalized_results() {
    let mut w = closed_world(100 * USDC);
    w.now += 365 * DAY;
    assert!(
        fails(|| w.call(&stranger()).rollover_unclaimed(1)),
        "no results"
    );
}

/// Deterministic pseudo-random sequence (64-bit LCG).
struct Lcg(u64);
impl Lcg {
    fn next(&mut self, n: u64) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (self.0 >> 33) % n
    }
}

#[test]
fn randomized_payout_bound() {
    let mut rng = Lcg(7);
    for round in 0..12 {
        let pot = (1 + rng.next(1_000)) as u128 * USDC + rng.next(1_000_000) as u128;
        let mut w = closed_world(pot);
        let n = 1 + rng.next(6) as usize;
        let mut make = |cap: u128, prefix: &str| {
            let mut left = cap;
            let mut out = Vec::new();
            for i in 0..n {
                let v = if left == 0 {
                    0
                } else {
                    1 + rng.next(u64::try_from(left).unwrap()) as u128
                };
                if v > 0 {
                    out.push((acc(&format!("{prefix}{round}x{i}.test.near")), v));
                    left -= v;
                }
            }
            Payouts::new(out)
        };
        let prize = make(pot * 7_500 / 10_000, "f");
        let bonus = make(pot * 2_500 / 10_000, "b");
        post(&mut w, 1, &prize, &bonus);
        if rng.next(4) == 0 {
            w.call(&guardian()).reject_results(1);
            post(&mut w, 1, &prize, &bonus);
        }
        w.now += HOUR;
        let mut paid = 0u128;
        for (kind, p) in [(ClaimKind::Prize, &prize), (ClaimKind::Bonus, &bonus)] {
            for (who, amount) in p.entries.clone() {
                claim(&mut w, kind, &who, p, amount, 1);
                let ok = rng.next(3) != 0;
                transfer_result(&mut w, ok, 1, kind, &who, amount);
                if ok {
                    paid += amount;
                }
                // A repeated claim always fails once paid.
                if ok {
                    assert!(fails(|| claim(&mut w, kind, &who, p, amount, 1)));
                }
            }
        }
        let r = w.arena.get_season(1).unwrap().results.unwrap();
        assert!(r.prize_claimed.0 <= r.prize_total.0 && r.bonus_claimed.0 <= r.bonus_total.0);
        assert!(paid <= r.pot_at_post.0);
        assert_eq!(r.prize_claimed.0 + r.bonus_claimed.0, paid);
        assert_eq!(w.arena.pot_of(1).0, pot - paid);
        assert_eq!(w.arena.total_pots().0, pot - paid);
        // Roll the rest over and the totals still add up.
        let opens = r.claim_opens_ms;
        w.now = opens + 30 * DAY;
        w.call(&stranger()).rollover_unclaimed(1);
        assert_eq!(w.arena.pot_of(2).0, pot - paid);
        assert_eq!(w.arena.total_pots().0, pot - paid);
    }
}
