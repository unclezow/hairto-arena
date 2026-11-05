//! Hairto Arena core contract.
//!
//! One contract holds the price ticks, the duel engine, damage configurations, seasons and season scores, so all
//! of them share state synchronously. The only cross-contract call in this version is `vault.can_play`.

use near_sdk::store::{IterableSet, LookupMap, LookupSet, Vector};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault, PublicKey};

pub mod admin;
pub mod damage;
pub mod duel;
pub mod events;
pub mod params;
pub mod picks;
pub mod pot;
pub mod score;
pub mod season;
pub mod ticks;
pub mod types;
pub mod views;

#[cfg(test)]
mod tests;

use damage::DamageConfig;
use params::{
    DEFAULT_CLAIM_PERIOD_MS, DEFAULT_CLOSE_DELAY_MS, DEFAULT_COUNTDOWN_MS,
    DEFAULT_DISPUTE_WINDOW_MS, DEFAULT_KO_IMMUNITY_MS, DEFAULT_MAX_STALENESS_MS,
    DEFAULT_PICK_WINDOW_MS, DEFAULT_RING_SIZE, DEFAULT_SEASON_DURATION_MS, MAX_RING_SIZE,
    MIN_RING_SIZE,
};
use types::{
    ActiveSlot, Asset, AssetId, Bot, BotLevel, ClaimKind, DamageConfigId, Duel, DuelId, DuelParams,
    Durations, Hash32, PendingPick, Position, Score, Season, SeasonId, SeasonResults, Side, Tick,
    TickIndex,
};

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Guardians,
    Operators,
    Pushers,
    Assets,
    AssetByFeed,
    Bots,
    BotLevelOf,
    Ticks,
    LatestTick,
    DamageConfigs,
    Duels,
    Positions,
    ActiveDuelOf,
    Nonces,
    Seasons,
    Scores,
    // Appended by the season economy.
    Keepers,
    Picks,
    PendingPicks,
    BackerCounts,
    Pots,
    SeasonResults,
    Claims,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Arena {
    // ---- owner and roles ----
    owner_id: AccountId,
    guardians: IterableSet<AccountId>,
    operators: IterableSet<AccountId>,
    pushers: IterableSet<AccountId>,
    paused: bool,

    // ---- external configuration ----
    vault_id: AccountId,
    bot_service_pk: Hash32,
    params: DuelParams,

    // ---- asset and bot registries ----
    /// Asset id `n` is stored at index `n - 1`.
    assets: Vector<Asset>,
    asset_by_feed: LookupMap<Hash32, AssetId>,
    bots: LookupMap<BotLevel, Bot>,
    bot_level_of: LookupMap<AccountId, BotLevel>,

    // ---- price ticks ----
    ring_size: u32,
    ticks: LookupMap<(AssetId, u32), Tick>,
    latest_tick: LookupMap<AssetId, TickIndex>,

    // ---- damage ----
    /// Configuration id `n` is stored at index `n - 1`.
    damage_configs: Vector<DamageConfig>,
    active_damage_config: DamageConfigId,

    // ---- duels ----
    duels: LookupMap<DuelId, Duel>,
    positions: LookupMap<(DuelId, Side), Position>,
    active_duel_of: LookupMap<AccountId, ActiveSlot>,
    nonces: LookupMap<AccountId, u64>,
    next_duel_id: DuelId,

    // ---- seasons and scores ----
    current_season: SeasonId,
    seasons: LookupMap<SeasonId, Season>,
    durations: Durations,
    scores: LookupMap<(SeasonId, AccountId), Score>,

    // ---- season economy: picks, pot, results, claims ----
    keepers: IterableSet<AccountId>,
    claims_paused: bool,
    token_id: Option<AccountId>,
    pick_of: LookupMap<(SeasonId, AccountId), AccountId>,
    /// At most one pending pick per Backer.
    pending_picks: LookupMap<AccountId, PendingPick>,
    backer_count: LookupMap<(SeasonId, AccountId), u32>,
    pot_of: LookupMap<SeasonId, u128>,
    total_pots: u128,
    season_results: LookupMap<SeasonId, SeasonResults>,
    claimed: LookupSet<(SeasonId, ClaimKind, AccountId)>,
}

#[near]
impl Arena {
    /// Deploy and call this in one transaction. `bot_service_pk` must be an ed25519 key. `ring_size` defaults to
    /// 1 024 ticks per asset and can never change afterwards.
    #[init]
    pub fn new(
        owner_id: AccountId,
        vault_id: AccountId,
        bot_service_pk: PublicKey,
        ring_size: Option<u32>,
    ) -> Self {
        let ring_size = ring_size.unwrap_or(DEFAULT_RING_SIZE);
        require!(
            (MIN_RING_SIZE..=MAX_RING_SIZE).contains(&ring_size),
            "ring size out of range"
        );
        let mut damage_configs = Vector::new(StorageKey::DamageConfigs);
        damage_configs.push(DamageConfig::default_asset_scaled());

        Self {
            owner_id,
            guardians: IterableSet::new(StorageKey::Guardians),
            operators: IterableSet::new(StorageKey::Operators),
            pushers: IterableSet::new(StorageKey::Pushers),
            paused: false,
            vault_id,
            bot_service_pk: admin::ed25519_bytes(&bot_service_pk),
            params: DuelParams {
                countdown_ms: DEFAULT_COUNTDOWN_MS,
                ko_immunity_ms: DEFAULT_KO_IMMUNITY_MS,
                max_staleness_ms: DEFAULT_MAX_STALENESS_MS,
            },
            assets: Vector::new(StorageKey::Assets),
            asset_by_feed: LookupMap::new(StorageKey::AssetByFeed),
            bots: LookupMap::new(StorageKey::Bots),
            bot_level_of: LookupMap::new(StorageKey::BotLevelOf),
            ring_size,
            ticks: LookupMap::new(StorageKey::Ticks),
            latest_tick: LookupMap::new(StorageKey::LatestTick),
            damage_configs,
            active_damage_config: 1,
            duels: LookupMap::new(StorageKey::Duels),
            positions: LookupMap::new(StorageKey::Positions),
            active_duel_of: LookupMap::new(StorageKey::ActiveDuelOf),
            nonces: LookupMap::new(StorageKey::Nonces),
            next_duel_id: 1,
            current_season: 0,
            seasons: LookupMap::new(StorageKey::Seasons),
            durations: Durations {
                season_duration_ms: DEFAULT_SEASON_DURATION_MS,
                pick_window_ms: DEFAULT_PICK_WINDOW_MS,
                dispute_window_ms: DEFAULT_DISPUTE_WINDOW_MS,
                close_delay_ms: DEFAULT_CLOSE_DELAY_MS,
                claim_period_ms: DEFAULT_CLAIM_PERIOD_MS,
            },
            scores: LookupMap::new(StorageKey::Scores),
            keepers: IterableSet::new(StorageKey::Keepers),
            claims_paused: false,
            token_id: None,
            pick_of: LookupMap::new(StorageKey::Picks),
            pending_picks: LookupMap::new(StorageKey::PendingPicks),
            backer_count: LookupMap::new(StorageKey::BackerCounts),
            pot_of: LookupMap::new(StorageKey::Pots),
            total_pots: 0,
            season_results: LookupMap::new(StorageKey::SeasonResults),
            claimed: LookupSet::new(StorageKey::Claims),
        }
    }
}

impl Arena {
    pub(crate) fn now_ms() -> u64 {
        env::block_timestamp_ms()
    }
}
