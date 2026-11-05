//! Unit tests with a mocked blockchain, a controlled clock, and a one-tick-per-second price feed.

mod admin;
mod damage;
mod duel;
mod score;
mod season;
mod ticket;
mod ticks;

use std::panic::{catch_unwind, AssertUnwindSafe};

use ed25519_dalek::{Signer, SigningKey};
use near_sdk::json_types::Base64VecU8;
use near_sdk::serde_json::{self, Value};
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, AccountId, CurveType, Gas, PublicKey};

use crate::duel::{commit_hash, seed_hash, ticket_message_bytes};
use crate::types::{AssetId, BotLevel, Dir, DuelId, Role, SeedTicket, TickInput};
use crate::Arena;

/// Block time of the first call, in ms.
pub const T0: u64 = 1_800_000_000_000;
/// Default price of the test feed: 1.00000000 with expo -8.
pub const P: i64 = 100_000_000;
pub const EXPO: i32 = -8;
pub const BTC: AssetId = 2;
pub const SEED: [u8; 32] = [9u8; 32];

pub fn acc(name: &str) -> AccountId {
    name.parse().unwrap()
}
pub fn arena_id() -> AccountId {
    acc("arena.test.near")
}
pub fn owner() -> AccountId {
    acc("owner.test.near")
}
pub fn guardian() -> AccountId {
    acc("guardian.test.near")
}
pub fn operator() -> AccountId {
    acc("ops.test.near")
}
pub fn pusher() -> AccountId {
    acc("pusher.test.near")
}
pub fn vault() -> AccountId {
    acc("vault.test.near")
}
pub fn fighter() -> AccountId {
    acc("fighter.test.near")
}
pub fn stranger() -> AccountId {
    acc("stranger.test.near")
}
pub fn bot_account(level: BotLevel) -> AccountId {
    match level {
        1 => acc("rookie.bots.test.near"),
        2 => acc("trend.bots.test.near"),
        3 => acc("reversion.bots.test.near"),
        _ => acc("oracle.bots.test.near"),
    }
}

/// 64 hex characters ending in `n`.
pub fn feed(n: u8) -> String {
    format!("{:064x}", n)
}

pub fn ctx_with_gas(caller: &AccountId, now_ms: u64, gas: Gas) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(arena_id())
        .predecessor_account_id(caller.clone())
        .signer_account_id(caller.clone())
        .block_timestamp(now_ms * 1_000_000)
        .prepaid_gas(gas);
    testing_env!(b.build());
}

pub fn ctx(caller: &AccountId, now_ms: u64) {
    ctx_with_gas(caller, now_ms, Gas::from_tgas(300));
}

/// True when `f` panics. Methods validate before writing, so state is unchanged after a failure.
pub fn fails<R>(f: impl FnOnce() -> R) -> bool {
    catch_unwind(AssertUnwindSafe(f)).is_err()
}

/// NEP-297 events logged since the last context switch.
pub fn events() -> Vec<Value> {
    get_logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .map(|j| serde_json::from_str(j).unwrap())
        .collect()
}

pub fn event_names() -> Vec<String> {
    events()
        .iter()
        .map(|e| e["event"].as_str().unwrap().to_string())
        .collect()
}

pub fn find_event(name: &str) -> Option<Value> {
    events().into_iter().find(|e| e["event"] == name)
}

pub fn public_key(key: &SigningKey) -> PublicKey {
    PublicKey::from_parts(CurveType::ED25519, key.verifying_key().to_bytes().to_vec()).unwrap()
}

pub fn b64(bytes: &[u8]) -> Base64VecU8 {
    Base64VecU8(bytes.to_vec())
}

/// A configured arena with roles, assets 1–3 (GOOGL, BTC, XAU), bots 1–3, season 1 running, and a feed for BTC.
pub struct World {
    pub arena: Arena,
    pub key: SigningKey,
    pub now: u64,
    pub last_push: u64,
    /// Price of the next pushed tick.
    pub price: i64,
    /// When false, `advance` pushes nothing (simulates an outage).
    pub feed_on: bool,
}

impl World {
    pub fn new() -> Self {
        Self::with_ring(None)
    }

    pub fn with_ring(ring_size: Option<u32>) -> Self {
        ctx(&owner(), T0);
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let mut arena = Arena::new(owner(), vault(), public_key(&key), ring_size);
        arena.grant_role(Role::Guardian, guardian());
        arena.grant_role(Role::Operator, operator());
        arena.grant_role(Role::Pusher, pusher());
        arena.add_asset(feed(1), "GOOGL".into());
        arena.add_asset(feed(2), "BTC".into());
        arena.add_asset(feed(3), "XAU".into());
        for level in 1..=3 {
            arena.set_bot(level, bot_account(level), true);
        }
        ctx(&operator(), T0);
        arena.start_season(vec![1, 2, 3]);
        let mut world = World {
            arena,
            key,
            now: T0,
            last_push: T0,
            price: P,
            feed_on: true,
        };
        world.push_at(T0);
        world
    }

    fn push_at(&mut self, t: u64) {
        ctx(&pusher(), t);
        self.arena.push_ticks(vec![TickInput {
            asset_id: BTC,
            price: self.price,
            expo: EXPO,
            publish_ms: t,
        }]);
        self.last_push = t;
    }

    /// Moves the clock to `to`, pushing one BTC tick per second on the way while the feed is on. Long jumps only
    /// push the last minute so tests can skip hours or days.
    pub fn advance(&mut self, to: u64) {
        let mut t = self.last_push + 1_000;
        if to > t + 60_000 {
            t += (to - 60_000 - t) / 1_000 * 1_000;
        }
        while self.feed_on && t <= to {
            self.push_at(t);
            t += 1_000;
        }
        if !self.feed_on {
            self.last_push = self.last_push.max(to - to % 1_000);
        }
        self.now = to;
    }

    /// Sets the price and pushes one tick a second later.
    pub fn tick_price(&mut self, price: i64) {
        self.price = price;
        let to = self.last_push + 1_000;
        self.advance(to.max(self.now));
    }

    pub fn call(&mut self, caller: &AccountId) -> &mut Arena {
        ctx(caller, self.now);
        &mut self.arena
    }

    pub fn ticket(
        &self,
        fighter: &AccountId,
        asset_id: AssetId,
        bot_level: BotLevel,
    ) -> SeedTicket {
        ctx(fighter, self.now);
        let nonce = self.arena.nonce_of(fighter.clone());
        SeedTicket {
            fighter: fighter.clone(),
            asset_id,
            bot_level,
            seed_hash: b64(&seed_hash(&SEED, fighter, nonce)),
            nonce,
            deadline_ms: self.now + 30_000,
        }
    }

    pub fn sign_with(key: &SigningKey, ticket: &SeedTicket, arena: AccountId) -> Base64VecU8 {
        b64(&key.sign(&ticket_message_bytes(ticket, arena)).to_bytes())
    }

    pub fn sign(&self, ticket: &SeedTicket) -> Base64VecU8 {
        Self::sign_with(&self.key, ticket, arena_id())
    }

    /// `start_duel` by the Fighter, then the callback with `answer` one block later. Returns the callback result.
    pub fn start_with(
        &mut self,
        bot_level: BotLevel,
        answer: Result<bool, near_sdk::PromiseError>,
    ) -> Option<DuelId> {
        let ticket = self.ticket(&fighter(), BTC, bot_level);
        let sig = self.sign(&ticket);
        let _ = self.call(&fighter()).start_duel(ticket.clone(), sig);
        self.advance(self.now + 1_000);
        self.call(&arena_id()).on_start_duel(ticket, answer)
    }

    /// A running level-1 duel. Returns its id and start time.
    pub fn start(&mut self) -> (DuelId, u64) {
        let id = self.start_with(1, Ok(true)).expect("duel created");
        let start = self.arena.get_duel(id).unwrap().start_ms;
        (id, start)
    }

    pub fn open(&mut self, duel_id: DuelId, player: &AccountId, dir: Dir, salt: u8) {
        let commit = commit_hash(dir, &[salt; 32], duel_id, player);
        self.call(player).open_position(duel_id, b64(&commit));
    }

    pub fn close(&mut self, duel_id: DuelId, player: &AccountId, dir: Dir, salt: u8) {
        self.call(player)
            .close_position(duel_id, dir, b64(&[salt; 32]));
    }

    pub fn reveal(&mut self, duel_id: DuelId) {
        self.call(&stranger())
            .reveal_bot_seed(duel_id, b64(&SEED), None);
    }
}
