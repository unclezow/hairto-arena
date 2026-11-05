//! Shared ids, enums and stored records.

use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::{near, AccountId};

pub type AssetId = u32;
pub type DuelId = u64;
pub type SeasonId = u32;
pub type TickIndex = u32;
pub type DamageConfigId = u32;
pub type BotLevel = u8;
pub type Hash32 = [u8; 32];

/// Position direction. The commit encodes it as `1` (Long) or `2` (Short).
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dir {
    Long,
    Short,
}

impl Dir {
    pub fn as_u8(self) -> u8 {
        match self {
            Dir::Long => 1,
            Dir::Short => 2,
        }
    }
}

/// The two players of a duel. Used as a compact storage key instead of account ids.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Side {
    Fighter,
    Bot,
}

impl Side {
    pub fn other(self) -> Side {
        match self {
            Side::Fighter => Side::Bot,
            Side::Bot => Side::Fighter,
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Active,
    Finished,
    Forfeited,
    Voided,
}

impl Status {
    pub fn is_terminal(self) -> bool {
        !matches!(self, Status::Active)
    }
}

/// Duel outcome from the Fighter's point of view.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Win,
    Loss,
    Draw,
}

/// Season phase. Stored values are `Active`, `Closed` and `ResultsPosted`; `Picking` is computed from the pick
/// window and `Finalized` from the end of the dispute window. New variants are only ever appended.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Picking,
    Active,
    Closed,
    ResultsPosted,
    Finalized,
}

impl Phase {
    /// Duels may start and scores may be recorded only in these phases.
    pub fn is_open(self) -> bool {
        matches!(self, Phase::Picking | Phase::Active)
    }
}

/// Roles the owner can grant. The owner holds none of them implicitly.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Guardian,
    Operator,
    Pusher,
    /// Posts season results.
    Keeper,
}

/// The two kinds of season payout, each with its own merkle root.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClaimKind {
    Prize,
    Bonus,
}

/// A Backer pick waiting for the vault's answers.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingPick {
    pub season: SeasonId,
    pub fighter: AccountId,
    pub since_ms: u64,
}

/// Posted results of a closed season.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SeasonResults {
    pub prize_root: Hash32,
    pub bonus_root: Hash32,
    pub prize_total: u128,
    pub bonus_total: u128,
    pub prize_claimed: u128,
    pub bonus_claimed: u128,
    /// `pot_of(season)` when the results were posted; claims never exceed it.
    pub pot_at_post: u128,
    pub results_posted_ms: u64,
    pub claim_opens_ms: u64,
    pub rolled_over: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SeasonResultsView {
    /// 32 bytes each; all zeros when the total is zero.
    pub prize_root: Base64VecU8,
    pub bonus_root: Base64VecU8,
    pub prize_total: U128,
    pub bonus_total: U128,
    pub prize_claimed: U128,
    pub bonus_claimed: U128,
    pub pot_at_post: U128,
    pub results_posted_ms: u64,
    pub claim_opens_ms: u64,
    pub rolled_over: bool,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tick {
    pub price: i64,
    pub expo: i32,
    pub publish_ms: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TickInput {
    pub asset_id: AssetId,
    pub price: i64,
    pub expo: i32,
    pub publish_ms: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TickView {
    pub index: TickIndex,
    pub price: i64,
    pub expo: i32,
    pub publish_ms: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Asset {
    pub feed_id: Hash32,
    pub symbol: String,
    pub active: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AssetView {
    pub asset_id: AssetId,
    /// Pyth feed id as 64 lowercase hex characters.
    pub feed_id: String,
    pub symbol: String,
    pub active: bool,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Bot {
    pub account_id: AccountId,
    pub active: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BotView {
    pub level: BotLevel,
    pub account_id: AccountId,
    pub active: bool,
}

/// Ticket the bot service signs so a Fighter can start a duel against a bot whose seed is committed.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SeedTicket {
    pub fighter: AccountId,
    pub asset_id: AssetId,
    pub bot_level: BotLevel,
    /// 32 bytes.
    pub seed_hash: Base64VecU8,
    pub nonce: u64,
    pub deadline_ms: u64,
}

/// What a Fighter has in flight: a duel waiting for the vault answer, or a running duel.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ActiveSlot {
    Pending { nonce: u64, since_ms: u64 },
    Active { duel_id: DuelId },
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Duel {
    pub fighter: AccountId,
    pub bot: AccountId,
    pub asset_id: AssetId,
    pub bot_level: BotLevel,
    pub season: SeasonId,
    pub nonce: u64,
    pub start_ms: u64,
    pub ko_ms: Option<u64>,
    pub hp_fighter: u16,
    pub hp_bot: u16,
    pub seed_hash: Hash32,
    pub status: Status,
    pub outcome: Option<Outcome>,
    pub winner: Option<Side>,
    pub ko: bool,
    pub damage_config_id: DamageConfigId,
    /// Parameters snapshotted at creation so owner changes only affect later duels.
    pub ko_immunity_ms: u64,
    pub max_staleness_ms: u64,
    pub settled_ms: Option<u64>,
}

impl Duel {
    pub fn end_ms(&self) -> u64 {
        self.start_ms + crate::params::ROUND_MS
    }

    /// Round end, brought forward by a KO.
    pub fn effective_end_ms(&self) -> u64 {
        match self.ko_ms {
            Some(ko) => ko.min(self.end_ms()),
            None => self.end_ms(),
        }
    }

    pub fn account_of(&self, side: Side) -> &AccountId {
        match side {
            Side::Fighter => &self.fighter,
            Side::Bot => &self.bot,
        }
    }

    pub fn hp_of(&self, side: Side) -> u16 {
        match side {
            Side::Fighter => self.hp_fighter,
            Side::Bot => self.hp_bot,
        }
    }

    pub fn set_hp(&mut self, side: Side, hp: u16) {
        match side {
            Side::Fighter => self.hp_fighter = hp,
            Side::Bot => self.hp_bot = hp,
        }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DuelView {
    pub duel_id: DuelId,
    pub fighter: AccountId,
    pub bot: AccountId,
    pub asset_id: AssetId,
    pub bot_level: BotLevel,
    pub season: SeasonId,
    pub nonce: u64,
    pub start_ms: u64,
    pub end_ms: u64,
    pub effective_end_ms: u64,
    pub ko_ms: Option<u64>,
    pub hp_fighter: u16,
    pub hp_bot: u16,
    pub seed_hash: Base64VecU8,
    pub status: Status,
    pub outcome: Option<Outcome>,
    pub winner: Option<AccountId>,
    pub ko: bool,
    pub damage_config_id: DamageConfigId,
    pub ko_immunity_ms: u64,
    pub settled_ms: Option<u64>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Position {
    pub commit: Hash32,
    pub open_tick: TickIndex,
    pub open_ms: u64,
    pub open: bool,
    pub trades: u8,
    pub score_ppm: i64,
    pub damage_dealt: u32,
}

/// A position as anyone may see it. The direction stays hidden until the player reveals it.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PositionView {
    pub commit: Base64VecU8,
    pub open_tick: TickIndex,
    pub open_ms: u64,
    pub open: bool,
    pub trades: u8,
    pub score_ppm: i64,
    pub damage_dealt: u32,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Season {
    pub start_ms: u64,
    pub pick_end_ms: u64,
    pub end_ms: u64,
    /// Stored phase: `Active` until closed, then `Closed`.
    pub phase: Phase,
    pub closed_ms: Option<u64>,
    pub close_delay_ms: u64,
    pub dispute_window_ms: u64,
    pub claim_period_ms: u64,
    pub asset_ids: Vec<AssetId>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SeasonView {
    pub season: SeasonId,
    pub phase: Phase,
    pub start_ms: u64,
    pub pick_end_ms: u64,
    pub end_ms: u64,
    pub closed_ms: Option<u64>,
    pub close_delay_ms: u64,
    pub dispute_window_ms: u64,
    pub claim_period_ms: u64,
    pub asset_ids: Vec<AssetId>,
    /// `pot_of(season)` now.
    pub pot: U128,
    /// Present once results are posted (also after finalization).
    pub results: Option<SeasonResultsView>,
}

/// Season durations applied to seasons started after they are set.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Durations {
    pub season_duration_ms: u64,
    pub pick_window_ms: u64,
    pub dispute_window_ms: u64,
    pub close_delay_ms: u64,
    pub claim_period_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Score {
    pub points: u64,
    pub duels: u32,
    pub wins: u32,
    pub reached_at_ms: u64,
}

/// Owner-adjustable duel parameters.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DuelParams {
    pub countdown_ms: u64,
    pub ko_immunity_ms: u64,
    pub max_staleness_ms: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigView {
    pub owner_id: AccountId,
    pub vault_id: AccountId,
    pub paused: bool,
    pub countdown_ms: u64,
    pub ko_immunity_ms: u64,
    pub max_staleness_ms: u64,
    pub ring_size: u32,
    pub active_damage_config: DamageConfigId,
    pub next_duel_id: DuelId,
    pub current_season: SeasonId,
    pub claims_paused: bool,
    /// USDC (mock) token that funds pots and pays claims; set once by the owner.
    pub token_id: Option<AccountId>,
    pub total_pots: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RolesView {
    pub owner_id: AccountId,
    pub guardians: Vec<AccountId>,
    pub operators: Vec<AccountId>,
    pub pushers: Vec<AccountId>,
    pub keepers: Vec<AccountId>,
}
