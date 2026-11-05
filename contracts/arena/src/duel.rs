//! Duel engine: seed-ticket creation with asynchronous vault eligibility, commit-reveal positions, on-chain KO,
//! settlement, outage void, bot seed reveal and storage cleanup.

use std::cmp::Ordering;

use near_sdk::json_types::Base64VecU8;
use near_sdk::{env, ext_contract, near, require, AccountId, Promise, PromiseError};

use crate::damage::{apply_hp, move_ppm, net_pnl_ppm, unrevealed_penalty_ppm};
use crate::events::ArenaEvent;
use crate::params::{
    GAS_FOR_CAN_PLAY, GAS_FOR_ON_START_DUEL, MAX_TRADES_PER_DUEL, MIN_GAS_FOR_START_DUEL,
    MIN_HOLD_MS, PENDING_TIMEOUT_MS, REVEAL_GRACE_MS, SEED_REVEAL_TIMEOUT_MS, STARTING_HP,
    TICKET_DOMAIN, TICKET_MAX_LIFETIME_MS, VOID_AFTER_OUTAGE_MS,
};
use crate::types::{
    ActiveSlot, Dir, Duel, DuelId, Hash32, Outcome, Position, SeedTicket, Side, Status, TickIndex,
};
use crate::{Arena, ArenaExt};

/// Largest `decisions_hash` accepted by `reveal_bot_seed`. It is only logged.
const MAX_DECISIONS_HASH_LEN: usize = 64;

#[ext_contract(ext_vault)]
pub trait Vault {
    fn can_play(&self, account_id: AccountId) -> bool;
}

/// Borsh payload of a ticket, with the seed hash as raw bytes.
#[near(serializers = [borsh])]
struct TicketPayload {
    fighter: AccountId,
    asset_id: u32,
    bot_level: u8,
    seed_hash: Hash32,
    nonce: u64,
    deadline_ms: u64,
}

/// What the bot service signs: `borsh(TicketMessage)`. Binding the arena account stops reuse across deployments.
#[near(serializers = [borsh])]
struct TicketMessage {
    domain: String,
    arena: AccountId,
    ticket: TicketPayload,
}

pub(crate) fn bytes32(value: &Base64VecU8, name: &str) -> Hash32 {
    value
        .0
        .as_slice()
        .try_into()
        .unwrap_or_else(|_| env::panic_str(&format!("{name} must be 32 bytes")))
}

/// Exact bytes the bot service signs for `ticket` on the arena account `arena`.
pub fn ticket_message_bytes(ticket: &SeedTicket, arena: AccountId) -> Vec<u8> {
    let message = TicketMessage {
        domain: TICKET_DOMAIN.to_string(),
        arena,
        ticket: TicketPayload {
            fighter: ticket.fighter.clone(),
            asset_id: ticket.asset_id,
            bot_level: ticket.bot_level,
            seed_hash: bytes32(&ticket.seed_hash, "seed_hash"),
            nonce: ticket.nonce,
            deadline_ms: ticket.deadline_ms,
        },
    };
    near_sdk::borsh::to_vec(&message).unwrap_or_else(|_| env::abort())
}

/// `sha256(borsh(dir: u8, salt: [u8; 32], duel_id: u64, player: AccountId))` with Long = 1 and Short = 2.
pub fn commit_hash(dir: Dir, salt: &Hash32, duel_id: DuelId, player: &AccountId) -> Hash32 {
    let bytes = near_sdk::borsh::to_vec(&(dir.as_u8(), salt, duel_id, player))
        .unwrap_or_else(|_| env::abort());
    env::sha256_array(bytes)
}

/// `sha256(borsh(seed: [u8; 32], fighter: AccountId, nonce: u64))`.
pub fn seed_hash(seed: &Hash32, fighter: &AccountId, nonce: u64) -> Hash32 {
    let bytes = near_sdk::borsh::to_vec(&(seed, fighter, nonce)).unwrap_or_else(|_| env::abort());
    env::sha256_array(bytes)
}

#[near]
impl Arena {
    // ---------------------------------------------------------------- create

    /// Fighter: starts a duel from a ticket signed by the bot service. Needs at least 60 Tgas and no deposit.
    /// The nonce is consumed immediately; the duel is created in `on_start_duel` if the vault says the Fighter
    /// can play.
    pub fn start_duel(&mut self, ticket: SeedTicket, signature: Base64VecU8) -> Promise {
        require!(!self.paused, "paused");
        require!(
            env::prepaid_gas() >= MIN_GAS_FOR_START_DUEL,
            "attach at least 60 Tgas"
        );
        let fighter = env::predecessor_account_id();
        require!(
            fighter == ticket.fighter,
            "caller is not the ticket fighter"
        );

        let sig: [u8; 64] = signature
            .0
            .as_slice()
            .try_into()
            .unwrap_or_else(|_| env::panic_str("signature must be 64 bytes"));
        let seed_hash = bytes32(&ticket.seed_hash, "seed_hash");
        require!(seed_hash != [0u8; 32], "seed hash must not be zero");
        let message = ticket_message_bytes(&ticket, env::current_account_id());
        require!(
            env::ed25519_verify(&sig, &message, &self.bot_service_pk),
            "invalid ticket signature"
        );

        let now = Self::now_ms();
        require!(
            now <= ticket.deadline_ms && ticket.deadline_ms <= now + TICKET_MAX_LIFETIME_MS,
            "ticket deadline out of range"
        );
        require!(
            ticket.nonce == self.nonce_of_internal(&fighter),
            "wrong nonce"
        );
        require!(
            !self.bot_level_of.contains_key(&fighter),
            "bots cannot fight"
        );
        require!(
            self.active_bot(ticket.bot_level).is_some(),
            "bot level not active"
        );
        require!(
            self.is_tradable_internal(ticket.asset_id),
            "asset not tradable"
        );
        require!(
            !self.is_stale_with(ticket.asset_id, self.params.max_staleness_ms),
            "price stale"
        );
        require!(
            self.open_season_for_duel(self.params.countdown_ms)
                .is_some(),
            "season not open"
        );
        require!(
            !self.active_duel_of.contains_key(&fighter),
            "duel already in progress"
        );

        self.nonces.insert(fighter.clone(), ticket.nonce + 1);
        self.active_duel_of.insert(
            fighter.clone(),
            ActiveSlot::Pending {
                nonce: ticket.nonce,
                since_ms: now,
            },
        );

        ext_vault::ext(self.vault_id.clone())
            .with_static_gas(GAS_FOR_CAN_PLAY)
            .can_play(fighter)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_ON_START_DUEL)
                    .on_start_duel(ticket),
            )
    }

    /// Callback of `start_duel`. Creates the duel, or clears the pending mark and emits `duel_rejected`.
    #[private]
    pub fn on_start_duel(
        &mut self,
        ticket: SeedTicket,
        #[callback_result] eligible: Result<bool, PromiseError>,
    ) -> Option<DuelId> {
        let fighter = ticket.fighter.clone();
        let pending = matches!(
            self.active_duel_of.get(&fighter),
            Some(ActiveSlot::Pending { nonce, .. }) if *nonce == ticket.nonce
        );
        if !pending {
            // The pending mark was cleared by `clear_stale_pending`; leave any newer state alone.
            ArenaEvent::DuelRejected {
                fighter,
                nonce: ticket.nonce,
                reason: "pending_cleared".to_string(),
            }
            .emit();
            return None;
        }

        let countdown_ms = self.params.countdown_ms;
        let reason = match eligible {
            Err(_) => Some("vault_error"),
            Ok(false) => Some("not_eligible"),
            Ok(true) if self.paused => Some("paused"),
            Ok(true) if self.is_stale_with(ticket.asset_id, self.params.max_staleness_ms) => {
                Some("stale_price")
            }
            Ok(true) if self.open_season_for_duel(countdown_ms).is_none() => Some("season_closed"),
            Ok(true) => None,
        };
        if let Some(reason) = reason {
            self.active_duel_of.remove(&fighter);
            ArenaEvent::DuelRejected {
                fighter,
                nonce: ticket.nonce,
                reason: reason.to_string(),
            }
            .emit();
            return None;
        }

        // A level can be toggled but never removed, so the account start_duel checked is still configured.
        let bot = self
            .bots
            .get(&ticket.bot_level)
            .map(|b| b.account_id.clone())
            .unwrap_or_else(|| env::abort());
        let season = self.current_season;
        let duel_id = self.next_duel_id;
        self.next_duel_id += 1;
        let start_ms = Self::now_ms() + countdown_ms;
        let duel = Duel {
            fighter: fighter.clone(),
            bot: bot.clone(),
            asset_id: ticket.asset_id,
            bot_level: ticket.bot_level,
            season,
            nonce: ticket.nonce,
            start_ms,
            ko_ms: None,
            hp_fighter: STARTING_HP,
            hp_bot: STARTING_HP,
            seed_hash: bytes32(&ticket.seed_hash, "seed_hash"),
            status: Status::Active,
            outcome: None,
            winner: None,
            ko: false,
            damage_config_id: self.active_damage_config,
            ko_immunity_ms: self.params.ko_immunity_ms,
            max_staleness_ms: self.params.max_staleness_ms,
            settled_ms: None,
        };
        self.duels.insert(duel_id, duel);
        self.active_duel_of
            .insert(fighter.clone(), ActiveSlot::Active { duel_id });
        ArenaEvent::DuelCreated {
            duel_id,
            fighter,
            bot,
            bot_level: ticket.bot_level,
            asset_id: ticket.asset_id,
            season,
            nonce: ticket.nonce,
            start_ms,
            damage_config_id: self.active_damage_config,
        }
        .emit();
        Some(duel_id)
    }

    /// Anyone: frees a Fighter whose eligibility callback never ran, 60 s after the pending mark.
    pub fn clear_stale_pending(&mut self, fighter: AccountId) {
        let Some(ActiveSlot::Pending { nonce, since_ms }) =
            self.active_duel_of.get(&fighter).cloned()
        else {
            env::panic_str("no pending duel")
        };
        require!(
            Self::now_ms() >= since_ms + PENDING_TIMEOUT_MS,
            "pending duel not stale yet"
        );
        self.active_duel_of.remove(&fighter);
        ArenaEvent::DuelRejected {
            fighter,
            nonce,
            reason: "pending_timeout".to_string(),
        }
        .emit();
    }

    // ---------------------------------------------------------------- positions

    /// Fighter or bot: opens a hidden position. `commit` is `compute_commit(dir, salt, duel_id, player)`.
    pub fn open_position(&mut self, duel_id: DuelId, commit: Base64VecU8) {
        let duel = self.active_duel(duel_id);
        let (side, player) = self.caller_side(&duel);
        let now = Self::now_ms();
        require!(
            duel.start_ms <= now && now < duel.effective_end_ms(),
            "round not open"
        );
        let commit = bytes32(&commit, "commit");
        require!(commit != [0u8; 32], "commit must not be zero");
        let mut pos = self.position_of(duel_id, side);
        require!(!pos.open, "position already open");
        require!(pos.trades < MAX_TRADES_PER_DUEL, "trade limit reached");
        require!(
            !self.is_stale_with(duel.asset_id, duel.max_staleness_ms),
            "price stale"
        );

        let open_tick = self.latest_index(duel.asset_id);
        pos.commit = commit;
        pos.open_tick = open_tick;
        pos.open_ms = now;
        pos.open = true;
        pos.trades += 1;
        self.positions.insert((duel_id, side), pos);
        ArenaEvent::PositionOpened {
            duel_id,
            side,
            player,
            open_tick,
        }
        .emit();
    }

    /// Fighter or bot: reveals and closes the open position. Before the round end it needs a 3 s hold and a fresh
    /// price and is priced at the latest tick; in the reveal grace it is priced at the round-end tick.
    pub fn close_position(&mut self, duel_id: DuelId, dir: Dir, salt: Base64VecU8) {
        let mut duel = self.active_duel(duel_id);
        let (side, player) = self.caller_side(&duel);
        let mut pos = self.position_of(duel_id, side);
        require!(pos.open, "no open position");
        let salt = bytes32(&salt, "salt");
        require!(
            commit_hash(dir, &salt, duel_id, &player) == pos.commit,
            "commit mismatch"
        );

        let now = Self::now_ms();
        let end = duel.effective_end_ms();
        let in_round = now < end;
        let close_tick = if in_round {
            require!(now - pos.open_ms >= MIN_HOLD_MS, "hold too short");
            require!(
                !self.is_stale_with(duel.asset_id, duel.max_staleness_ms),
                "price stale"
            );
            self.latest_index(duel.asset_id)
        } else if now < end + REVEAL_GRACE_MS {
            self.try_tick_at(duel.asset_id, end)
                .unwrap_or_else(|| env::panic_str("no tick at round end"))
        } else {
            env::panic_str("reveal window closed")
        };

        let mv = move_ppm(
            self.tick(duel.asset_id, pos.open_tick),
            self.tick(duel.asset_id, close_tick),
        );
        let paper_cost = self
            .damage_config_or_panic(duel.damage_config_id)
            .paper_cost_ppm();
        let net = net_pnl_ppm(mv, dir == Dir::Long, paper_cost);
        pos.open = false;
        let (self_delta, opponent_delta) = self.apply_result(&mut duel, &mut pos, side, net);

        let immune = now < duel.start_ms + duel.ko_immunity_ms;
        let ko = in_round
            && !immune
            && duel.ko_ms.is_none()
            && (duel.hp_fighter == 0 || duel.hp_bot == 0);
        if ko {
            duel.ko_ms = Some(now);
        }

        ArenaEvent::PositionClosed {
            duel_id,
            side,
            player,
            dir,
            close_tick,
            net_pnl_ppm: net,
            self_delta,
            opponent_delta,
            hp_fighter: duel.hp_fighter,
            hp_bot: duel.hp_bot,
            ko,
        }
        .emit();
        self.positions.insert((duel_id, side), pos);
        self.duels.insert(duel_id, duel);
    }

    // ---------------------------------------------------------------- settle and void

    /// Anyone: settles a duel once the round (or KO) plus the reveal grace is over. Voids it on a price outage.
    pub fn settle_duel(&mut self, duel_id: DuelId) {
        let mut duel = self.active_duel(duel_id);
        let now = Self::now_ms();
        let end = duel.effective_end_ms();
        require!(now >= end + REVEAL_GRACE_MS, "duel not over");
        if self.has_outage(&duel) {
            self.void(duel_id, duel);
            return;
        }

        let end_tick = self
            .try_tick_at(duel.asset_id, end)
            .unwrap_or_else(|| env::abort());
        for side in [Side::Fighter, Side::Bot] {
            self.penalize_if_open(duel_id, &mut duel, side, end_tick);
        }

        duel.settled_ms = Some(now);
        self.active_duel_of.remove(&duel.fighter);
        let fighter_pos = self.position_of(duel_id, Side::Fighter);
        if fighter_pos.trades == 0 {
            duel.status = Status::Forfeited;
            duel.outcome = Some(Outcome::Loss);
            duel.winner = Some(Side::Bot);
            ArenaEvent::DuelForfeited {
                duel_id,
                fighter: duel.fighter.clone(),
            }
            .emit();
            self.duels.insert(duel_id, duel);
            return;
        }

        let bot_pos = self.position_of(duel_id, Side::Bot);
        let (winner, ko) = match (duel.hp_fighter == 0, duel.hp_bot == 0) {
            (true, false) => (Some(Side::Bot), true),
            (false, true) => (Some(Side::Fighter), true),
            _ => {
                let order = fighter_pos
                    .score_ppm
                    .cmp(&bot_pos.score_ppm)
                    .then(fighter_pos.damage_dealt.cmp(&bot_pos.damage_dealt))
                    .then(duel.hp_fighter.cmp(&duel.hp_bot));
                let winner = match order {
                    Ordering::Greater => Some(Side::Fighter),
                    Ordering::Less => Some(Side::Bot),
                    Ordering::Equal => None,
                };
                (winner, false)
            }
        };
        let outcome = match winner {
            Some(Side::Fighter) => Outcome::Win,
            Some(Side::Bot) => Outcome::Loss,
            None => Outcome::Draw,
        };
        duel.status = Status::Finished;
        duel.outcome = Some(outcome);
        duel.winner = winner;
        duel.ko = ko;
        ArenaEvent::DuelFinished {
            duel_id,
            winner: winner.map(|s| duel.account_of(s).clone()),
            outcome,
            ko,
            hp_fighter: duel.hp_fighter,
            hp_bot: duel.hp_bot,
        }
        .emit();
        self.duels.insert(duel_id, duel);
    }

    /// Anyone: voids an active duel whose price feed had an outage. Never records a score.
    pub fn void_duel(&mut self, duel_id: DuelId) {
        let duel = self.active_duel(duel_id);
        require!(
            Self::now_ms() >= duel.start_ms && self.has_outage(&duel),
            "no outage"
        );
        self.void(duel_id, duel);
    }

    // ---------------------------------------------------------------- reveal and prune

    /// Anyone: reveals the bot seed of a terminal duel, records the season score when the reveal is timely, and
    /// deletes the duel from storage.
    pub fn reveal_bot_seed(
        &mut self,
        duel_id: DuelId,
        seed: Base64VecU8,
        decisions_hash: Option<Base64VecU8>,
    ) {
        let duel = self
            .duels
            .get(&duel_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown duel"));
        require!(duel.status.is_terminal(), "duel not over");
        let seed_bytes = bytes32(&seed, "seed");
        require!(
            seed_hash(&seed_bytes, &duel.fighter, duel.nonce) == duel.seed_hash,
            "seed mismatch"
        );
        if let Some(h) = &decisions_hash {
            require!(
                h.0.len() <= MAX_DECISIONS_HASH_LEN,
                "decisions hash too long"
            );
        }
        ArenaEvent::BotSeedRevealed {
            duel_id,
            seed,
            decisions_hash,
        }
        .emit();

        let settled_ms = duel.settled_ms.unwrap_or_default();
        let timely = Self::now_ms() <= settled_ms + SEED_REVEAL_TIMEOUT_MS;
        let season_open = self.phase_of(duel.season).is_some_and(|p| p.is_open());
        if duel.status != Status::Voided && timely && season_open {
            if let Some(outcome) = duel.outcome {
                self.record_result(
                    duel.season,
                    duel.fighter.clone(),
                    duel_id,
                    duel.bot_level,
                    outcome,
                    duel.hp_fighter,
                    duel.hp_bot,
                    duel.status == Status::Forfeited,
                );
            }
        }
        self.delete_duel(duel_id);
    }

    /// Anyone: deletes a terminal duel whose seed was not revealed within 10 minutes of settlement.
    pub fn prune_duel(&mut self, duel_id: DuelId) {
        let duel = self
            .duels
            .get(&duel_id)
            .unwrap_or_else(|| env::panic_str("unknown duel"));
        require!(duel.status.is_terminal(), "duel not over");
        let settled_ms = duel.settled_ms.unwrap_or_default();
        require!(
            Self::now_ms() > settled_ms + SEED_REVEAL_TIMEOUT_MS,
            "seed reveal window still open"
        );
        self.delete_duel(duel_id);
        ArenaEvent::DuelPruned { duel_id }.emit();
    }
}

impl Arena {
    pub(crate) fn nonce_of_internal(&self, account_id: &AccountId) -> u64 {
        self.nonces.get(account_id).copied().unwrap_or(0)
    }

    fn active_duel(&self, duel_id: DuelId) -> Duel {
        let duel = self
            .duels
            .get(&duel_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown duel"));
        require!(duel.status == Status::Active, "duel not active");
        duel
    }

    fn caller_side(&self, duel: &Duel) -> (Side, AccountId) {
        let caller = env::predecessor_account_id();
        let side = if caller == duel.fighter {
            Side::Fighter
        } else if caller == duel.bot {
            Side::Bot
        } else {
            env::panic_str("not a participant")
        };
        (side, caller)
    }

    pub(crate) fn position_of(&self, duel_id: DuelId, side: Side) -> Position {
        self.positions
            .get(&(duel_id, side))
            .cloned()
            .unwrap_or_default()
    }

    /// Adds `net` to the player's score and applies the duel's damage configuration to both sides.
    fn apply_result(
        &self,
        duel: &mut Duel,
        pos: &mut Position,
        side: Side,
        net: i32,
    ) -> (i32, i32) {
        let (self_delta, opponent_delta) = self
            .damage_config_or_panic(duel.damage_config_id)
            .hp_deltas(net, duel.asset_id);
        pos.score_ppm = pos.score_ppm.saturating_add(i64::from(net));
        pos.damage_dealt = pos
            .damage_dealt
            .saturating_add(opponent_delta.unsigned_abs());
        let immune = Self::now_ms() < duel.start_ms + duel.ko_immunity_ms;
        duel.set_hp(side, apply_hp(duel.hp_of(side), self_delta, immune));
        let other = side.other();
        duel.set_hp(other, apply_hp(duel.hp_of(other), opponent_delta, immune));
        (self_delta, opponent_delta)
    }

    fn penalize_if_open(
        &mut self,
        duel_id: DuelId,
        duel: &mut Duel,
        side: Side,
        end_tick: TickIndex,
    ) {
        let mut pos = self.position_of(duel_id, side);
        if !pos.open {
            return;
        }
        pos.open = false;
        let mv = move_ppm(
            self.tick(duel.asset_id, pos.open_tick),
            self.tick(duel.asset_id, end_tick),
        );
        let net = unrevealed_penalty_ppm(mv);
        let (self_delta, opponent_delta) = self.apply_result(duel, &mut pos, side, net);
        ArenaEvent::PositionPenalized {
            duel_id,
            side,
            player: duel.account_of(side).clone(),
            net_pnl_ppm: net,
            self_delta,
            opponent_delta,
            hp_fighter: duel.hp_fighter,
            hp_bot: duel.hp_bot,
        }
        .emit();
        self.positions.insert((duel_id, side), pos);
    }

    /// True when the ticks show a gap longer than the outage limit inside `[start_ms, min(now, effective_end_ms)]`
    /// (counting the gap from the last tick to the window end), or when the ring holds no tick at or before
    /// `start_ms`. The window stops at a KO because later ticks never price the duel.
    pub(crate) fn has_outage(&self, duel: &Duel) -> bool {
        let up_to = Self::now_ms().min(duel.effective_end_ms());
        let Some(mut idx) = self.try_tick_at(duel.asset_id, duel.start_ms) else {
            return true;
        };
        let latest = self.latest_index(duel.asset_id);
        let mut last = self.tick(duel.asset_id, idx).publish_ms;
        while idx < latest {
            idx += 1;
            let t = self.tick(duel.asset_id, idx).publish_ms;
            if t > up_to {
                break;
            }
            if t - last > VOID_AFTER_OUTAGE_MS {
                return true;
            }
            last = t;
        }
        up_to > last && up_to - last > VOID_AFTER_OUTAGE_MS
    }

    fn void(&mut self, duel_id: DuelId, mut duel: Duel) {
        duel.status = Status::Voided;
        duel.settled_ms = Some(Self::now_ms());
        self.active_duel_of.remove(&duel.fighter);
        self.duels.insert(duel_id, duel);
        ArenaEvent::DuelVoided { duel_id }.emit();
    }

    fn delete_duel(&mut self, duel_id: DuelId) {
        self.duels.remove(&duel_id);
        self.positions.remove(&(duel_id, Side::Fighter));
        self.positions.remove(&(duel_id, Side::Bot));
    }
}
