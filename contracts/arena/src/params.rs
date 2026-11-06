//! Game constants and parameter bounds. All times are milliseconds.
//!
//! Keep in sync with `packages/shared/src/params.ts` once that package is ported.

use near_sdk::Gas;

// ---- Duel ----
/// Length of the single trading round.
pub const ROUND_MS: u64 = 30_000;
/// Time after the round (or a KO) in which open positions can still be revealed, priced at the round-end tick.
pub const REVEAL_GRACE_MS: u64 = 10_000;
/// A bot seed revealed later than this after settlement records no score, and the duel can be pruned.
pub const SEED_REVEAL_TIMEOUT_MS: u64 = 600_000;
pub const MAX_TRADES_PER_DUEL: u8 = 4;
/// Shortest time between the price of the open and the price of the close.
pub const MIN_HOLD_MS: u64 = 1_000;
/// A tick the caller picks for an open or a close may be at most this much older than the block that executes it.
/// It covers the age of the tick when it was seen plus the time the transaction needs to land.
pub const MAX_TICK_LOOKBACK_MS: u64 = 6_000;
pub const STARTING_HP: u16 = 1_000;

// ---- Seed tickets and pending duels ----
pub const TICKET_DOMAIN: &str = "hairto-arena/seed-ticket/v1";
/// `deadline_ms` may be at most this far in the future.
pub const TICKET_MAX_LIFETIME_MS: u64 = 60_000;
/// A pending duel whose callback never ran can be cleared after this.
pub const PENDING_TIMEOUT_MS: u64 = 60_000;

// ---- Gas for the eligibility round trip ----
pub const GAS_FOR_CAN_PLAY: Gas = Gas::from_tgas(5);
pub const GAS_FOR_ON_START_DUEL: Gas = Gas::from_tgas(40);
/// Minimum prepaid gas for `start_duel`. The frontend attaches 100 Tgas.
pub const MIN_GAS_FOR_START_DUEL: Gas = Gas::from_tgas(60);

// ---- Gas for the pick round trip (two joined vault views) ----
pub const GAS_FOR_CAN_PICK: Gas = Gas::from_tgas(5);
pub const GAS_FOR_ROLE_OF: Gas = Gas::from_tgas(5);
pub const GAS_FOR_ON_PICK: Gas = Gas::from_tgas(20);
/// Minimum prepaid gas for `pick`.
pub const MIN_GAS_FOR_PICK: Gas = Gas::from_tgas(50);

// ---- Season results and claims ----
pub const BPS: u128 = 10_000;
/// Fighter prizes may use at most 75% of the pot, Backer bonuses at most 25%.
pub const PRIZE_CAP_BPS: u128 = 7_500;
pub const BONUS_CAP_BPS: u128 = 2_500;
pub const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(10);
pub const GAS_FOR_ON_CLAIM: Gas = Gas::from_tgas(10);
/// Minimum prepaid gas for `claim_prize` and `claim_bonus`.
pub const MIN_GAS_FOR_CLAIM: Gas = Gas::from_tgas(30);

// ---- Damage. PnL unit is ppm: 1 ppm = 0.01 bps ----
pub const PPM: i128 = 1_000_000;
pub const PPM_PER_BPS: i64 = 100;
pub const UNREVEALED_BASE_PENALTY_PPM: i64 = 100;
/// Default `AssetScaled` configuration installed at init as id 1.
pub const DEFAULT_HP_PER_BPS: u32 = 450;
pub const DEFAULT_MAX_HIT_HP: u16 = 400;
pub const DEFAULT_PAPER_COST_PPM: i32 = 0;
/// Per-asset scales of the default configuration: 1 GOOGL, 2 BTC, 3 XAU.
pub const DEFAULT_HP_PER_BPS_BY_ASSET: [(u32, u32); 3] = [(1, 600), (2, 400), (3, 1_500)];

// ---- Price feed ----
pub const DEFAULT_RING_SIZE: u32 = 1_024;
pub const MIN_RING_SIZE: u32 = 64;
pub const MAX_RING_SIZE: u32 = 8_192;
/// A gap between ticks longer than this inside a round voids the duel.
pub const VOID_AFTER_OUTAGE_MS: u64 = 10_000;

// ---- Owner-adjustable duel parameters: (default, min, max) ----
pub const DEFAULT_COUNTDOWN_MS: u64 = 5_000;
pub const MIN_COUNTDOWN_MS: u64 = 1_000;
pub const MAX_COUNTDOWN_MS: u64 = 15_000;
pub const DEFAULT_KO_IMMUNITY_MS: u64 = 5_000;
pub const MIN_KO_IMMUNITY_MS: u64 = 0;
pub const MAX_KO_IMMUNITY_MS: u64 = 20_000;
pub const DEFAULT_MAX_STALENESS_MS: u64 = 5_000;
pub const MIN_MAX_STALENESS_MS: u64 = 1_000;
pub const MAX_MAX_STALENESS_MS: u64 = 30_000;

// ---- Bots ----
pub const MAX_BOT_LEVEL: u8 = 4;
pub const MAX_SYMBOL_LEN: usize = 16;

// ---- Season score ----
pub const MIN_DUELS_FOR_LEADERBOARD: u32 = 10;

/// Points range of one bot level: `(win_min, win_max, loss_min, loss_max)`.
pub struct PointsRange {
    pub win_min: u64,
    pub win_max: u64,
    pub loss_min: u64,
    pub loss_max: u64,
}

/// Indexed by `level - 1`: Rookie, Trend, Reversion, Oracle.
pub const POINTS_BY_LEVEL: [PointsRange; 4] = [
    PointsRange {
        win_min: 5,
        win_max: 10,
        loss_min: 4,
        loss_max: 10,
    },
    PointsRange {
        win_min: 8,
        win_max: 15,
        loss_min: 2,
        loss_max: 7,
    },
    PointsRange {
        win_min: 12,
        win_max: 20,
        loss_min: 1,
        loss_max: 5,
    },
    PointsRange {
        win_min: 15,
        win_max: 25,
        loss_min: 1,
        loss_max: 4,
    },
];

// ---- Season durations ----
const MINUTE_MS: u64 = 60_000;
const HOUR_MS: u64 = 60 * MINUTE_MS;
const DAY_MS: u64 = 24 * HOUR_MS;

pub const DEFAULT_SEASON_DURATION_MS: u64 = 7 * DAY_MS;
pub const DEFAULT_PICK_WINDOW_MS: u64 = 24 * HOUR_MS;
pub const DEFAULT_DISPUTE_WINDOW_MS: u64 = HOUR_MS;
pub const DEFAULT_CLOSE_DELAY_MS: u64 = 15 * MINUTE_MS;
pub const DEFAULT_CLAIM_PERIOD_MS: u64 = 30 * DAY_MS;

pub const MIN_SEASON_DURATION_MS: u64 = 10 * MINUTE_MS;
pub const MAX_SEASON_DURATION_MS: u64 = 90 * DAY_MS;
pub const MIN_DISPUTE_WINDOW_MS: u64 = MINUTE_MS;
pub const MAX_DISPUTE_WINDOW_MS: u64 = 7 * DAY_MS;
pub const MIN_CLOSE_DELAY_MS: u64 = MINUTE_MS;
pub const MAX_CLOSE_DELAY_MS: u64 = DAY_MS;
pub const MIN_CLAIM_PERIOD_MS: u64 = MINUTE_MS;
pub const MAX_CLAIM_PERIOD_MS: u64 = 365 * DAY_MS;
