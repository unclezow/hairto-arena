//! Test-only stand-in for the vault contract.
//!
//! The arena asks the vault `can_play(account_id)` before it creates a duel, and `can_pick(backer)` joined with
//! `role_of(fighter)` before it stores a Backer pick. This mock answers with configurable defaults plus per-account
//! overrides, and can be switched to panic so tests cover the failed-promise paths of the arena callbacks.

use near_sdk::store::LookupMap;
use near_sdk::{env, near, AccountId, PanicOnDefault};

/// Mirror of the vault's pool, which is also the depositor's role.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pool {
    Fighter,
    Backer,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockVault {
    default_answer: bool,
    overrides: LookupMap<AccountId, bool>,
    /// `can_play` panics.
    panic_mode: bool,
    pick_default: bool,
    pick_overrides: LookupMap<AccountId, bool>,
    roles: LookupMap<AccountId, Pool>,
    /// `can_pick` and `role_of` panic.
    pick_panic_mode: bool,
}

#[near]
impl MockVault {
    /// `default_answer` is the default for both `can_play` and `can_pick`.
    #[init]
    pub fn new(default_answer: bool) -> Self {
        Self {
            default_answer,
            overrides: LookupMap::new(b"o"),
            panic_mode: false,
            pick_default: default_answer,
            pick_overrides: LookupMap::new(b"p"),
            roles: LookupMap::new(b"r"),
            pick_panic_mode: false,
        }
    }

    /// `can_play` answer for every account without an override.
    pub fn set_default(&mut self, answer: bool) {
        self.default_answer = answer;
    }

    /// `can_play` answer for one account.
    pub fn set_answer(&mut self, account_id: AccountId, answer: bool) {
        self.overrides.insert(account_id, answer);
    }

    /// When true, `can_play` panics.
    pub fn set_panic_mode(&mut self, enabled: bool) {
        self.panic_mode = enabled;
    }

    /// `can_pick` answer for every account without an override.
    pub fn set_pick_default(&mut self, answer: bool) {
        self.pick_default = answer;
    }

    /// `can_pick` answer for one account.
    pub fn set_pick_answer(&mut self, account_id: AccountId, answer: bool) {
        self.pick_overrides.insert(account_id, answer);
    }

    /// `role_of` answer for one account; `None` removes it.
    pub fn set_role(&mut self, account_id: AccountId, role: Option<Pool>) {
        match role {
            Some(pool) => {
                self.roles.insert(account_id, pool);
            }
            None => {
                self.roles.remove(&account_id);
            }
        }
    }

    /// When true, `can_pick` and `role_of` panic.
    pub fn set_pick_panic_mode(&mut self, enabled: bool) {
        self.pick_panic_mode = enabled;
    }

    pub fn can_play(&self, account_id: AccountId) -> bool {
        if self.panic_mode {
            env::panic_str("mock vault panic mode");
        }
        self.overrides
            .get(&account_id)
            .copied()
            .unwrap_or(self.default_answer)
    }

    pub fn can_pick(&self, account_id: AccountId) -> bool {
        if self.pick_panic_mode {
            env::panic_str("mock vault pick panic mode");
        }
        self.pick_overrides
            .get(&account_id)
            .copied()
            .unwrap_or(self.pick_default)
    }

    pub fn role_of(&self, account_id: AccountId) -> Option<Pool> {
        if self.pick_panic_mode {
            env::panic_str("mock vault pick panic mode");
        }
        self.roles.get(&account_id).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alice() -> AccountId {
        "alice.test.near".parse().unwrap()
    }

    #[test]
    fn default_and_override() {
        let mut vault = MockVault::new(true);
        assert!(vault.can_play(alice()));
        vault.set_answer(alice(), false);
        assert!(!vault.can_play(alice()));
        vault.set_default(false);
        assert!(!vault.can_play("bob.test.near".parse().unwrap()));
    }

    #[test]
    fn pick_answers_and_roles() {
        let mut vault = MockVault::new(true);
        assert!(vault.can_pick(alice()));
        vault.set_pick_answer(alice(), false);
        assert!(!vault.can_pick(alice()));
        vault.set_pick_default(false);
        assert!(!vault.can_pick("bob.test.near".parse().unwrap()));
        assert_eq!(vault.role_of(alice()), None);
        vault.set_role(alice(), Some(Pool::Fighter));
        assert_eq!(vault.role_of(alice()), Some(Pool::Fighter));
        vault.set_role(alice(), None);
        assert_eq!(vault.role_of(alice()), None);
    }

    #[test]
    #[should_panic(expected = "mock vault pick panic mode")]
    fn pick_panic_mode() {
        let mut vault = MockVault::new(true);
        vault.set_pick_panic_mode(true);
        vault.role_of(alice());
    }

    #[test]
    #[should_panic(expected = "mock vault panic mode")]
    fn panic_mode() {
        let mut vault = MockVault::new(true);
        vault.set_panic_mode(true);
        vault.can_play(alice());
    }
}
