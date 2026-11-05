//! Read-only views. None of them needs a role.

use near_sdk::json_types::Base64VecU8;
use near_sdk::{env, near, AccountId, CurveType, PublicKey};

use crate::admin::feed_id_hex;
use crate::duel::{bytes32, commit_hash, seed_hash, ticket_message_bytes};
use crate::params::MAX_BOT_LEVEL;
use crate::types::{
    ActiveSlot, AssetId, AssetView, BotLevel, BotView, ConfigView, Dir, DuelId, DuelView,
    PositionView, Role, RolesView, SeedTicket, Side,
};
use crate::{Arena, ArenaExt};

#[near]
impl Arena {
    // ---------------------------------------------------------------- configuration and roles

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            owner_id: self.owner_id.clone(),
            vault_id: self.vault_id.clone(),
            paused: self.paused,
            countdown_ms: self.params.countdown_ms,
            ko_immunity_ms: self.params.ko_immunity_ms,
            max_staleness_ms: self.params.max_staleness_ms,
            ring_size: self.ring_size,
            active_damage_config: self.active_damage_config,
            next_duel_id: self.next_duel_id,
            current_season: self.current_season,
        }
    }

    pub fn get_roles(&self) -> RolesView {
        RolesView {
            owner_id: self.owner_id.clone(),
            guardians: self.guardians.iter().cloned().collect(),
            operators: self.operators.iter().cloned().collect(),
            pushers: self.pushers.iter().cloned().collect(),
        }
    }

    pub fn has_role(&self, role: Role, account_id: AccountId) -> bool {
        self.has_role_internal(role, &account_id)
    }

    pub fn owner_id(&self) -> AccountId {
        self.owner_id.clone()
    }

    pub fn vault_id(&self) -> AccountId {
        self.vault_id.clone()
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    pub fn bot_service_key(&self) -> PublicKey {
        PublicKey::from_parts(CurveType::ED25519, self.bot_service_pk.to_vec())
            .unwrap_or_else(|_| env::abort())
    }

    // ---------------------------------------------------------------- assets and bots

    pub fn get_asset(&self, asset_id: AssetId) -> Option<AssetView> {
        self.asset(asset_id).map(|a| AssetView {
            asset_id,
            feed_id: feed_id_hex(&a.feed_id),
            symbol: a.symbol.clone(),
            active: a.active,
        })
    }

    pub fn get_assets(&self) -> Vec<AssetView> {
        (1..=self.assets.len())
            .filter_map(|id| self.get_asset(id))
            .collect()
    }

    /// True when the asset exists and is active.
    pub fn is_tradable(&self, asset_id: AssetId) -> bool {
        self.is_tradable_internal(asset_id)
    }

    pub fn get_bot(&self, level: BotLevel) -> Option<BotView> {
        self.bots.get(&level).map(|b| BotView {
            level,
            account_id: b.account_id.clone(),
            active: b.active,
        })
    }

    pub fn get_bots(&self) -> Vec<BotView> {
        (1..=MAX_BOT_LEVEL)
            .filter_map(|level| self.get_bot(level))
            .collect()
    }

    pub fn bot_level_of(&self, account_id: AccountId) -> Option<BotLevel> {
        self.bot_level_of.get(&account_id).copied()
    }

    // ---------------------------------------------------------------- duels

    pub fn get_duel(&self, duel_id: DuelId) -> Option<DuelView> {
        let d = self.duels.get(&duel_id)?;
        Some(DuelView {
            duel_id,
            fighter: d.fighter.clone(),
            bot: d.bot.clone(),
            asset_id: d.asset_id,
            bot_level: d.bot_level,
            season: d.season,
            nonce: d.nonce,
            start_ms: d.start_ms,
            end_ms: d.end_ms(),
            effective_end_ms: d.effective_end_ms(),
            ko_ms: d.ko_ms,
            hp_fighter: d.hp_fighter,
            hp_bot: d.hp_bot,
            seed_hash: Base64VecU8(d.seed_hash.to_vec()),
            status: d.status,
            outcome: d.outcome,
            winner: d.winner.map(|s| d.account_of(s).clone()),
            ko: d.ko,
            damage_config_id: d.damage_config_id,
            ko_immunity_ms: d.ko_immunity_ms,
            settled_ms: d.settled_ms,
        })
    }

    /// Never exposes the direction: only the commit until the player reveals it in `close_position`.
    pub fn get_position(&self, duel_id: DuelId, side: Side) -> Option<PositionView> {
        if !self.duels.contains_key(&duel_id) {
            return None;
        }
        let p = self.position_of(duel_id, side);
        Some(PositionView {
            commit: Base64VecU8(p.commit.to_vec()),
            open_tick: p.open_tick,
            open_ms: p.open_ms,
            open: p.open,
            trades: p.trades,
            score_ppm: p.score_ppm,
            damage_dealt: p.damage_dealt,
        })
    }

    pub fn active_duel_of(&self, fighter: AccountId) -> Option<ActiveSlot> {
        self.active_duel_of.get(&fighter).cloned()
    }

    pub fn nonce_of(&self, fighter: AccountId) -> u64 {
        self.nonce_of_internal(&fighter)
    }

    /// `sha256(borsh(dir as u8, salt, duel_id, player))` with Long = 1 and Short = 2.
    pub fn compute_commit(
        &self,
        dir: Dir,
        salt: Base64VecU8,
        duel_id: DuelId,
        player: AccountId,
    ) -> Base64VecU8 {
        Base64VecU8(commit_hash(dir, &bytes32(&salt, "salt"), duel_id, &player).to_vec())
    }

    /// `sha256(borsh(seed, fighter, nonce))`.
    pub fn compute_seed_hash(
        &self,
        seed: Base64VecU8,
        fighter: AccountId,
        nonce: u64,
    ) -> Base64VecU8 {
        Base64VecU8(seed_hash(&bytes32(&seed, "seed"), &fighter, nonce).to_vec())
    }

    /// Exact bytes the bot service signs with its ed25519 key for this arena account.
    pub fn ticket_message(&self, ticket: SeedTicket) -> Base64VecU8 {
        Base64VecU8(ticket_message_bytes(&ticket, env::current_account_id()))
    }
}
