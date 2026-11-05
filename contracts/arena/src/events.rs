//! NEP-297 events. Every log is `EVENT_JSON:{"standard":"hairto","version":"1.0.0","event":"<name>","data":{...}}`.

use near_sdk::json_types::Base64VecU8;
use near_sdk::{near, AccountId};

use crate::damage::DamageConfig;
use crate::types::{
    AssetId, BotLevel, DamageConfigId, Dir, DuelId, DuelParams, Durations, Outcome, Role, SeasonId,
    Side, TickIndex,
};

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PushedTick {
    pub asset_id: AssetId,
    pub index: TickIndex,
    pub price: i64,
    pub expo: i32,
    pub publish_ms: u64,
}

#[near(event_json(standard = "hairto"))]
pub enum ArenaEvent {
    // ---- price feed ----
    #[event_version("1.0.0")]
    TicksPushed { ticks: Vec<PushedTick> },

    // ---- admin ----
    #[event_version("1.0.0")]
    AssetAdded {
        asset_id: AssetId,
        feed_id: String,
        symbol: String,
    },
    #[event_version("1.0.0")]
    AssetStatusChanged { asset_id: AssetId, active: bool },
    #[event_version("1.0.0")]
    BotConfigured {
        level: BotLevel,
        account_id: AccountId,
        active: bool,
    },
    #[event_version("1.0.0")]
    DamageConfigAdded {
        id: DamageConfigId,
        config: DamageConfig,
    },
    #[event_version("1.0.0")]
    DamageConfigActivated { id: DamageConfigId },
    #[event_version("1.0.0")]
    ParamsUpdated { params: DuelParams },
    /// `role` is `None` for an ownership transfer.
    #[event_version("1.0.0")]
    RoleChanged {
        role: Option<Role>,
        account_id: AccountId,
        granted: bool,
    },
    #[event_version("1.0.0")]
    Paused { by: AccountId },
    #[event_version("1.0.0")]
    Unpaused { by: AccountId },

    // ---- duels ----
    #[event_version("1.0.0")]
    DuelCreated {
        duel_id: DuelId,
        fighter: AccountId,
        bot: AccountId,
        bot_level: BotLevel,
        asset_id: AssetId,
        season: SeasonId,
        nonce: u64,
        start_ms: u64,
        damage_config_id: DamageConfigId,
    },
    #[event_version("1.0.0")]
    DuelRejected {
        fighter: AccountId,
        nonce: u64,
        reason: String,
    },
    #[event_version("1.0.0")]
    PositionOpened {
        duel_id: DuelId,
        side: Side,
        player: AccountId,
        open_tick: TickIndex,
    },
    #[event_version("1.0.0")]
    PositionClosed {
        duel_id: DuelId,
        side: Side,
        player: AccountId,
        dir: Dir,
        close_tick: TickIndex,
        net_pnl_ppm: i32,
        self_delta: i32,
        opponent_delta: i32,
        hp_fighter: u16,
        hp_bot: u16,
        ko: bool,
    },
    #[event_version("1.0.0")]
    PositionPenalized {
        duel_id: DuelId,
        side: Side,
        player: AccountId,
        net_pnl_ppm: i32,
        self_delta: i32,
        opponent_delta: i32,
        hp_fighter: u16,
        hp_bot: u16,
    },
    #[event_version("1.0.0")]
    DuelFinished {
        duel_id: DuelId,
        winner: Option<AccountId>,
        outcome: Outcome,
        ko: bool,
        hp_fighter: u16,
        hp_bot: u16,
    },
    #[event_version("1.0.0")]
    DuelForfeited { duel_id: DuelId, fighter: AccountId },
    #[event_version("1.0.0")]
    DuelVoided { duel_id: DuelId },
    #[event_version("1.0.0")]
    BotSeedRevealed {
        duel_id: DuelId,
        seed: Base64VecU8,
        decisions_hash: Option<Base64VecU8>,
    },
    #[event_version("1.0.0")]
    ResultRecorded {
        season: SeasonId,
        fighter: AccountId,
        duel_id: DuelId,
        outcome: Outcome,
        points: i64,
    },
    #[event_version("1.0.0")]
    DuelPruned { duel_id: DuelId },

    // ---- seasons ----
    #[event_version("1.0.0")]
    SeasonStarted {
        season: SeasonId,
        start_ms: u64,
        pick_end_ms: u64,
        end_ms: u64,
        asset_ids: Vec<AssetId>,
    },
    #[event_version("1.0.0")]
    SeasonEndedEarly { season: SeasonId, end_ms: u64 },
    #[event_version("1.0.0")]
    SeasonClosed { season: SeasonId, closed_ms: u64 },
    #[event_version("1.0.0")]
    DurationsUpdated { durations: Durations },
}
