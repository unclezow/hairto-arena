//! Versioned damage configurations and the PnL / HP arithmetic of a closed position.

use near_sdk::{env, near, require};

use crate::events::ArenaEvent;
use crate::params::{
    DEFAULT_HP_PER_BPS, DEFAULT_HP_PER_BPS_BY_ASSET, DEFAULT_MAX_HIT_HP, DEFAULT_PAPER_COST_PPM,
    PPM, PPM_PER_BPS, STARTING_HP, UNREVEALED_BASE_PENALTY_PPM,
};
use crate::types::{AssetId, DamageConfigId, Tick};
use crate::{Arena, ArenaExt};

/// How a position's net PnL turns into HP changes. Stored configurations never change; each duel keeps the id it
/// was created with.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DamageConfig {
    /// HP = |net PnL in bps| x the asset's HP-per-bp, capped per hit. Profit hits the opponent, loss hits the owner.
    AssetScaled {
        paper_cost_ppm: i32,
        default_hp_per_bps: u32,
        max_hit_hp: u16,
        /// `(asset_id, hp_per_bps)` pairs.
        hp_per_bps: Vec<(AssetId, u32)>,
    },
    /// HP = |net PnL in ppm| / `ppm_per_hp`, capped at the starting HP. The HP gap tracks the PnL gap.
    PnlDifference {
        ppm_per_hp: u32,
        paper_cost_ppm: i32,
    },
}

impl DamageConfig {
    /// Configuration id 1, installed at init.
    pub fn default_asset_scaled() -> Self {
        DamageConfig::AssetScaled {
            paper_cost_ppm: DEFAULT_PAPER_COST_PPM,
            default_hp_per_bps: DEFAULT_HP_PER_BPS,
            max_hit_hp: DEFAULT_MAX_HIT_HP,
            hp_per_bps: DEFAULT_HP_PER_BPS_BY_ASSET.to_vec(),
        }
    }

    pub fn validate(&self) {
        match self {
            DamageConfig::AssetScaled {
                paper_cost_ppm,
                default_hp_per_bps,
                max_hit_hp,
                hp_per_bps,
            } => {
                require!(*paper_cost_ppm >= 0, "paper cost must not be negative");
                require!(*default_hp_per_bps > 0, "scale must be positive");
                require!(
                    *max_hit_hp > 0 && *max_hit_hp <= STARTING_HP,
                    "max hit must be within 1..=starting HP"
                );
                for (i, (asset_id, scale)) in hp_per_bps.iter().enumerate() {
                    require!(*scale > 0, "scale must be positive");
                    require!(
                        hp_per_bps[..i].iter().all(|(other, _)| other != asset_id),
                        "duplicate asset scale"
                    );
                }
            }
            DamageConfig::PnlDifference {
                ppm_per_hp,
                paper_cost_ppm,
            } => {
                require!(*ppm_per_hp > 0, "ppm per HP must be positive");
                require!(*paper_cost_ppm >= 0, "paper cost must not be negative");
            }
        }
    }

    pub fn paper_cost_ppm(&self) -> i32 {
        match self {
            DamageConfig::AssetScaled { paper_cost_ppm, .. } => *paper_cost_ppm,
            DamageConfig::PnlDifference { paper_cost_ppm, .. } => *paper_cost_ppm,
        }
    }

    /// HP per bp of PnL on `asset_id` (`AssetScaled` only).
    pub fn hp_per_bps_of(&self, asset_id: AssetId) -> Option<u32> {
        match self {
            DamageConfig::AssetScaled {
                default_hp_per_bps,
                hp_per_bps,
                ..
            } => Some(
                hp_per_bps
                    .iter()
                    .find(|(id, _)| *id == asset_id)
                    .map(|(_, scale)| *scale)
                    .unwrap_or(*default_hp_per_bps),
            ),
            DamageConfig::PnlDifference { .. } => None,
        }
    }

    /// `(self_delta, opponent_delta)`, both `<= 0`, for a position with `net_ppm` on `asset_id`.
    pub fn hp_deltas(&self, net_ppm: i32, asset_id: AssetId) -> (i32, i32) {
        let magnitude = i64::from(net_ppm).abs();
        let hp = match self {
            DamageConfig::AssetScaled { max_hit_hp, .. } => {
                let scale = i64::from(self.hp_per_bps_of(asset_id).unwrap_or(1));
                (magnitude * scale / PPM_PER_BPS).min(i64::from(*max_hit_hp))
            }
            DamageConfig::PnlDifference { ppm_per_hp, .. } => {
                (magnitude / i64::from(*ppm_per_hp)).min(i64::from(STARTING_HP))
            }
        } as i32;
        match net_ppm {
            n if n > 0 => (0, -hp),
            n if n < 0 => (-hp, 0),
            _ => (0, 0),
        }
    }
}

/// Signed price change from `open` to `close` in ppm. Both prices are normalized to the smaller exponent and the
/// result is truncated toward zero. Exponent gaps that overflow `i128` (far beyond any real feed) saturate.
pub fn move_ppm(open: &Tick, close: &Tick) -> i128 {
    let base = open.expo.min(close.expo);
    let pa = normalize(open.price, open.expo - base);
    let pb = normalize(close.price, close.expo - base);
    match (pa, pb) {
        (Some(pa), Some(pb)) => {
            let diff = pb - pa;
            match diff.checked_mul(PPM) {
                Some(scaled) => scaled / pa,
                None if diff > 0 => i128::MAX,
                None => i128::MIN,
            }
        }
        // A price that overflows after normalization is larger than any unscaled i64 price.
        (Some(_), None) => i128::MAX,
        (None, Some(_)) => -PPM,
        (None, None) => 0,
    }
}

fn normalize(price: i64, shift: i32) -> Option<i128> {
    10i128
        .checked_pow(u32::try_from(shift).ok()?)
        .and_then(|factor| i128::from(price).checked_mul(factor))
}

pub fn clamp_i32(value: i128) -> i32 {
    value.clamp(i128::from(i32::MIN), i128::from(i32::MAX)) as i32
}

/// Net PnL of a revealed position: the move signed by direction, minus the paper cost, clamped to `i32`.
pub fn net_pnl_ppm(move_ppm: i128, long: bool, paper_cost_ppm: i32) -> i32 {
    let signed = if long {
        move_ppm
    } else {
        move_ppm.saturating_neg()
    };
    clamp_i32(signed.saturating_sub(i128::from(paper_cost_ppm)))
}

/// Net PnL charged to a position that was never revealed: `-(|move| + 100)`. Always worse than revealing.
pub fn unrevealed_penalty_ppm(move_ppm: i128) -> i32 {
    let abs_move = i128::from(clamp_i32(move_ppm.saturating_abs()));
    clamp_i32(-(abs_move + i128::from(UNREVEALED_BASE_PENALTY_PPM)))
}

/// Applies `delta` to `hp` within `[0, STARTING_HP]`, never below 1 while `immune`.
pub fn apply_hp(hp: u16, delta: i32, immune: bool) -> u16 {
    let floor = if immune { 1 } else { 0 };
    let next = (i64::from(hp) + i64::from(delta)).clamp(0, i64::from(STARTING_HP));
    next.max(floor.min(i64::from(hp))) as u16
}

#[near]
impl Arena {
    /// Owner: stores a new immutable configuration under the next id. It is not activated.
    pub fn add_damage_config(&mut self, config: DamageConfig) -> DamageConfigId {
        self.assert_owner();
        config.validate();
        self.damage_configs.push(config.clone());
        let id = self.damage_configs.len();
        ArenaEvent::DamageConfigAdded { id, config }.emit();
        id
    }

    /// Owner: new duels use configuration `id`. Running duels keep the id they started with.
    pub fn activate_damage_config(&mut self, id: DamageConfigId) {
        self.assert_owner();
        require!(
            id >= 1 && id <= self.damage_configs.len(),
            "unknown damage config"
        );
        self.active_damage_config = id;
        ArenaEvent::DamageConfigActivated { id }.emit();
    }

    pub fn get_damage_config(&self, id: DamageConfigId) -> Option<DamageConfig> {
        self.damage_config(id).cloned()
    }

    pub fn active_damage_config_id(&self) -> DamageConfigId {
        self.active_damage_config
    }

    pub fn damage_config_count(&self) -> u32 {
        self.damage_configs.len()
    }
}

impl Arena {
    pub(crate) fn damage_config(&self, id: DamageConfigId) -> Option<&DamageConfig> {
        if id == 0 {
            return None;
        }
        self.damage_configs.get(id - 1)
    }

    pub(crate) fn damage_config_or_panic(&self, id: DamageConfigId) -> &DamageConfig {
        self.damage_config(id)
            .unwrap_or_else(|| env::panic_str("unknown damage config"))
    }
}
