//! Owner, roles, pause, bounded parameters, and the asset and bot registries.

use near_sdk::{env, near, require, AccountId, CurveType, PublicKey};

use crate::events::ArenaEvent;
use crate::params::{
    MAX_BOT_LEVEL, MAX_COUNTDOWN_MS, MAX_KO_IMMUNITY_MS, MAX_MAX_STALENESS_MS, MAX_SYMBOL_LEN,
    MIN_COUNTDOWN_MS, MIN_KO_IMMUNITY_MS, MIN_MAX_STALENESS_MS,
};
use crate::types::{Asset, AssetId, Bot, BotLevel, Hash32, Role};
use crate::{Arena, ArenaExt};

/// Raw 32 bytes of an ed25519 public key. Fails for any other curve.
pub fn ed25519_bytes(key: &PublicKey) -> Hash32 {
    require!(
        key.curve_type() == CurveType::ED25519,
        "bot service key must be ed25519"
    );
    key.as_bytes()[1..]
        .try_into()
        .unwrap_or_else(|_| env::panic_str("bot service key must be ed25519"))
}

/// Parses a Pyth feed id given as 64 hex characters.
pub fn parse_feed_id(hex: &str) -> Hash32 {
    let bytes = hex.as_bytes();
    require!(bytes.len() == 64, "feed id must be 64 hex characters");
    let mut out = [0u8; 32];
    for (i, pair) in bytes.chunks(2).enumerate() {
        out[i] = (hex_digit(pair[0]) << 4) | hex_digit(pair[1]);
    }
    require!(out != [0u8; 32], "feed id must not be zero");
    out
}

fn hex_digit(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        b'A'..=b'F' => c - b'A' + 10,
        _ => env::panic_str("feed id must be 64 hex characters"),
    }
}

pub fn feed_id_hex(bytes: &Hash32) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(64);
    for b in bytes {
        s.push(DIGITS[(b >> 4) as usize] as char);
        s.push(DIGITS[(b & 0x0f) as usize] as char);
    }
    s
}

fn require_bounded(value: Option<u64>, min: u64, max: u64, name: &str) {
    if let Some(v) = value {
        if v < min || v > max {
            env::panic_str(&format!("{name} out of range"));
        }
    }
}

#[near]
impl Arena {
    // ---------------------------------------------------------------- owner and roles

    pub fn transfer_ownership(&mut self, new_owner_id: AccountId) {
        self.assert_owner();
        self.owner_id = new_owner_id.clone();
        ArenaEvent::RoleChanged {
            role: None,
            account_id: new_owner_id,
            granted: true,
        }
        .emit();
    }

    pub fn grant_role(&mut self, role: Role, account_id: AccountId) {
        self.assert_owner();
        if self.role_set_mut(role).insert(account_id.clone()) {
            ArenaEvent::RoleChanged {
                role: Some(role),
                account_id,
                granted: true,
            }
            .emit();
        }
    }

    pub fn revoke_role(&mut self, role: Role, account_id: AccountId) {
        self.assert_owner();
        if self.role_set_mut(role).remove(&account_id) {
            ArenaEvent::RoleChanged {
                role: Some(role),
                account_id,
                granted: false,
            }
            .emit();
        }
    }

    // ---------------------------------------------------------------- pause

    /// Guardian: stops new duels only. Running duels can always finish.
    pub fn pause(&mut self) {
        self.assert_role(Role::Guardian);
        self.paused = true;
        ArenaEvent::Paused {
            by: env::predecessor_account_id(),
        }
        .emit();
    }

    pub fn unpause(&mut self) {
        self.assert_role(Role::Guardian);
        self.paused = false;
        ArenaEvent::Unpaused {
            by: env::predecessor_account_id(),
        }
        .emit();
    }

    // ---------------------------------------------------------------- parameters

    /// Owner: updates the given parameters within their bounds. Applies to duels created afterwards.
    pub fn set_params(
        &mut self,
        countdown_ms: Option<u64>,
        ko_immunity_ms: Option<u64>,
        max_staleness_ms: Option<u64>,
    ) {
        self.assert_owner();
        require_bounded(
            countdown_ms,
            MIN_COUNTDOWN_MS,
            MAX_COUNTDOWN_MS,
            "countdown_ms",
        );
        require_bounded(
            ko_immunity_ms,
            MIN_KO_IMMUNITY_MS,
            MAX_KO_IMMUNITY_MS,
            "ko_immunity_ms",
        );
        require_bounded(
            max_staleness_ms,
            MIN_MAX_STALENESS_MS,
            MAX_MAX_STALENESS_MS,
            "max_staleness_ms",
        );
        if let Some(v) = countdown_ms {
            self.params.countdown_ms = v;
        }
        if let Some(v) = ko_immunity_ms {
            self.params.ko_immunity_ms = v;
        }
        if let Some(v) = max_staleness_ms {
            self.params.max_staleness_ms = v;
        }
        ArenaEvent::ParamsUpdated {
            params: self.params.clone(),
        }
        .emit();
    }

    pub fn set_vault_id(&mut self, vault_id: AccountId) {
        self.assert_owner();
        self.vault_id = vault_id;
    }

    /// Owner: rotates the key that signs seed tickets. Tickets signed by the previous key stop working.
    pub fn set_bot_service_key(&mut self, public_key: PublicKey) {
        self.assert_owner();
        self.bot_service_pk = ed25519_bytes(&public_key);
    }

    // ---------------------------------------------------------------- assets

    /// Owner: registers a tradable asset by its Pyth feed id (64 hex characters). Ids start at 1.
    pub fn add_asset(&mut self, feed_id: String, symbol: String) -> AssetId {
        self.assert_owner();
        let feed = parse_feed_id(&feed_id);
        require!(
            !symbol.is_empty() && symbol.len() <= MAX_SYMBOL_LEN,
            "symbol must be 1 to 16 bytes"
        );
        require!(
            !self.asset_by_feed.contains_key(&feed),
            "feed already registered"
        );
        self.assets.push(Asset {
            feed_id: feed,
            symbol: symbol.clone(),
            active: true,
        });
        let asset_id = self.assets.len();
        self.asset_by_feed.insert(feed, asset_id);
        ArenaEvent::AssetAdded {
            asset_id,
            feed_id: feed_id_hex(&feed),
            symbol,
        }
        .emit();
        asset_id
    }

    pub fn set_asset_active(&mut self, asset_id: AssetId, active: bool) {
        self.assert_owner();
        let asset = self
            .asset_mut(asset_id)
            .unwrap_or_else(|| env::panic_str("unknown asset"));
        asset.active = active;
        ArenaEvent::AssetStatusChanged { asset_id, active }.emit();
    }

    // ---------------------------------------------------------------- bots

    /// Owner: binds bot level 1–4 to an account. An account serves at most one level.
    pub fn set_bot(&mut self, level: BotLevel, account_id: AccountId, active: bool) {
        self.assert_owner();
        require!(
            (1..=MAX_BOT_LEVEL).contains(&level),
            "bot level must be 1 to 4"
        );
        require!(
            account_id != env::current_account_id(),
            "bot cannot be the arena"
        );
        if let Some(existing) = self.bot_level_of.get(&account_id) {
            require!(*existing == level, "account already serves another level");
        }
        if let Some(previous) = self.bots.get(&level) {
            if previous.account_id != account_id {
                let previous_account = previous.account_id.clone();
                self.bot_level_of.remove(&previous_account);
            }
        }
        self.bots.insert(
            level,
            Bot {
                account_id: account_id.clone(),
                active,
            },
        );
        self.bot_level_of.insert(account_id.clone(), level);
        ArenaEvent::BotConfigured {
            level,
            account_id,
            active,
        }
        .emit();
    }

    /// Owner: enables or disables a configured level. Running duels at that level continue.
    pub fn set_bot_active(&mut self, level: BotLevel, active: bool) {
        self.assert_owner();
        let bot = self
            .bots
            .get_mut(&level)
            .unwrap_or_else(|| env::panic_str("bot level not configured"));
        bot.active = active;
        let account_id = bot.account_id.clone();
        ArenaEvent::BotConfigured {
            level,
            account_id,
            active,
        }
        .emit();
    }
}

impl Arena {
    pub(crate) fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "only the owner"
        );
    }

    pub(crate) fn has_role_internal(&self, role: Role, account_id: &AccountId) -> bool {
        match role {
            Role::Guardian => self.guardians.contains(account_id),
            Role::Operator => self.operators.contains(account_id),
            Role::Pusher => self.pushers.contains(account_id),
        }
    }

    pub(crate) fn assert_role(&self, role: Role) {
        if !self.has_role_internal(role, &env::predecessor_account_id()) {
            env::panic_str(&format!("missing role {role:?}"));
        }
    }

    fn role_set_mut(&mut self, role: Role) -> &mut near_sdk::store::IterableSet<AccountId> {
        match role {
            Role::Guardian => &mut self.guardians,
            Role::Operator => &mut self.operators,
            Role::Pusher => &mut self.pushers,
        }
    }

    pub(crate) fn asset(&self, asset_id: AssetId) -> Option<&Asset> {
        if asset_id == 0 {
            return None;
        }
        self.assets.get(asset_id - 1)
    }

    fn asset_mut(&mut self, asset_id: AssetId) -> Option<&mut Asset> {
        if asset_id == 0 {
            return None;
        }
        self.assets.get_mut(asset_id - 1)
    }

    pub(crate) fn is_tradable_internal(&self, asset_id: AssetId) -> bool {
        self.asset(asset_id).is_some_and(|a| a.active)
    }

    pub(crate) fn active_bot(&self, level: BotLevel) -> Option<&Bot> {
        self.bots.get(&level).filter(|b| b.active)
    }
}
