//! `duel-damage` scenarios and arithmetic edge cases.

use crate::damage::{
    apply_hp, clamp_i32, move_ppm, net_pnl_ppm, unrevealed_penalty_ppm, DamageConfig,
};
use crate::types::Tick;

fn t(price: i64, expo: i32) -> Tick {
    Tick {
        price,
        expo,
        publish_ms: 0,
    }
}

fn asset_scaled() -> DamageConfig {
    DamageConfig::default_asset_scaled()
}

#[test]
fn profitable_long() {
    let mv = move_ppm(&t(10_000, -2), &t(10_003, -2));
    assert_eq!(mv, 300);
    assert_eq!(net_pnl_ppm(mv, true, 0), 300);
}

#[test]
fn mixed_exponents() {
    // 100.000 (expo -3) vs 100.01 (expo -2): compared as 100 000 and 100 010 at expo -3.
    let mv = move_ppm(&t(100_000, -3), &t(10_001, -2));
    assert_eq!(mv, 100);
    // Same in the other direction of normalization.
    assert_eq!(move_ppm(&t(10_001, -2), &t(100_000, -3)), -99);
}

#[test]
fn short_flips_sign() {
    let mv = move_ppm(&t(10_000, -2), &t(10_003, -2));
    assert_eq!(net_pnl_ppm(mv, false, 0), -300);
}

#[test]
fn truncates_toward_zero_and_subtracts_paper_cost() {
    // +1/3 of a ppm and -1/3 of a ppm both truncate to 0.
    assert_eq!(move_ppm(&t(3_000_000, 0), &t(3_000_001, 0)), 0);
    assert_eq!(move_ppm(&t(3_000_000, 0), &t(2_999_999, 0)), 0);
    assert_eq!(move_ppm(&t(3_000_000, 0), &t(2_999_996, 0)), -1);
    assert_eq!(net_pnl_ppm(300, true, 25), 275);
    assert_eq!(net_pnl_ppm(300, false, 25), -325);
}

#[test]
fn extreme_values_clamp_to_i32() {
    let mv = move_ppm(&t(1, 0), &t(i64::MAX, 0));
    assert!(mv > i128::from(i32::MAX));
    assert_eq!(net_pnl_ppm(mv, true, 0), i32::MAX);
    assert_eq!(net_pnl_ppm(mv, false, 0), i32::MIN);
    assert_eq!(clamp_i32(i128::MIN), i32::MIN);
    // Exponent gaps that overflow i128 saturate instead of failing.
    assert_eq!(move_ppm(&t(1, -100), &t(1, 100)), i128::MAX);
    assert_eq!(move_ppm(&t(1, 100), &t(1, -100)), -1_000_000);
}

#[test]
fn btc_hit() {
    // Asset 2 scales ×400: 50 ppm = 0.5 bp -> 200 HP.
    assert_eq!(asset_scaled().hp_deltas(50, 2), (0, -200));
}

#[test]
fn hit_is_capped() {
    // Asset 3 scales ×1500: 100 ppm -> 1500 HP, capped at 400.
    assert_eq!(asset_scaled().hp_deltas(100, 3), (0, -400));
    assert_eq!(asset_scaled().hp_deltas(-100, 3), (-400, 0));
}

#[test]
fn default_scale() {
    // An asset without its own scale uses ×450: -20 ppm -> the owner loses 90 HP.
    assert_eq!(asset_scaled().hp_deltas(-20, 7), (-90, 0));
    assert_eq!(asset_scaled().hp_deltas(0, 7), (0, 0));
    assert_eq!(asset_scaled().hp_per_bps_of(1), Some(600));
    assert_eq!(asset_scaled().hp_per_bps_of(9), Some(450));
}

#[test]
fn pnl_difference_profit() {
    let c = DamageConfig::PnlDifference {
        ppm_per_hp: 10,
        paper_cost_ppm: 0,
    };
    assert_eq!(c.hp_deltas(500, 1), (0, -50));
    assert_eq!(c.hp_deltas(-500, 1), (-50, 0));
    // Capped at the starting HP.
    assert_eq!(c.hp_deltas(i32::MAX, 1), (0, -1_000));
    assert_eq!(c.hp_per_bps_of(1), None);
}

#[test]
fn unrevealed_penalty() {
    assert_eq!(unrevealed_penalty_ppm(200), -300);
    assert_eq!(unrevealed_penalty_ppm(-200), -300);
    assert_eq!(unrevealed_penalty_ppm(0), -100);
    assert_eq!(unrevealed_penalty_ppm(i128::MIN), i32::MIN);
    // Never better than revealing in either direction.
    for mv in [-5_000i128, -1, 0, 1, 7_777] {
        let p = unrevealed_penalty_ppm(mv);
        assert!(p < net_pnl_ppm(mv, true, 0) && p < net_pnl_ppm(mv, false, 0));
    }
}

#[test]
fn hp_bounds() {
    assert_eq!(apply_hp(300, -400, false), 0);
    assert_eq!(apply_hp(300, -400, true), 1, "immunity keeps 1 HP");
    assert_eq!(apply_hp(1, -50, true), 1);
    assert_eq!(apply_hp(1_000, 500, false), 1_000);
    assert_eq!(apply_hp(0, -10, true), 0);
    assert_eq!(apply_hp(500, 0, false), 500);
}

/// Deterministic pseudo-random sequence (64-bit LCG) so the property test needs no extra dependency.
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }
}

/// Under `PnlDifference`, as long as HP is not clamped, the HP difference has the same sign as the score
/// difference. Nets are multiples of `ppm_per_hp` so integer division does not truncate.
#[test]
fn pnl_difference_hp_gap_tracks_score_gap() {
    let ppm_per_hp = 10u32;
    let c = DamageConfig::PnlDifference {
        ppm_per_hp,
        paper_cost_ppm: 0,
    };
    let mut rng = Lcg(42);
    for _ in 0..2_000 {
        let (mut hp_f, mut hp_b) = (1_000i64, 1_000i64);
        let (mut score_f, mut score_b) = (0i64, 0i64);
        for _ in 0..8 {
            let fighter_closes = rng.next().is_multiple_of(2);
            // Nets within ±1 000 ppm, multiples of ppm_per_hp: at most 8 × 100 HP, so no clamping.
            let net = ((rng.next() % 201) as i32 - 100) * ppm_per_hp as i32;
            let (self_delta, opp_delta) = c.hp_deltas(net, 1);
            if fighter_closes {
                score_f += i64::from(net);
                hp_f += i64::from(self_delta);
                hp_b += i64::from(opp_delta);
            } else {
                score_b += i64::from(net);
                hp_b += i64::from(self_delta);
                hp_f += i64::from(opp_delta);
            }
            assert!((0..=1_000).contains(&hp_f) && (0..=1_000).contains(&hp_b));
            assert_eq!((hp_f - hp_b).signum(), (score_f - score_b).signum());
        }
    }
}
