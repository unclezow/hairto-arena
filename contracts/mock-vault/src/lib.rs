//! Test-only stand-in for the vault contract.
//!
//! The arena asks the vault `can_play(account_id)` before it creates a duel. This mock answers with a
//! configurable default plus per-account overrides, and can be switched to panic so tests cover the
//! failed-promise path of the arena callback.

use near_sdk::store::LookupMap;
use near_sdk::{near, AccountId, PanicOnDefault};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockVault {
    default_answer: bool,
    overrides: LookupMap<AccountId, bool>,
    panic_mode: bool,
}

#[near]
impl MockVault {
    #[init]
    pub fn new(default_answer: bool) -> Self {
        Self {
            default_answer,
            overrides: LookupMap::new(b"o"),
            panic_mode: false,
        }
    }

    /// Answer for every account without an override.
    pub fn set_default(&mut self, answer: bool) {
        self.default_answer = answer;
    }

    /// Answer for one account.
    pub fn set_answer(&mut self, account_id: AccountId, answer: bool) {
        self.overrides.insert(account_id, answer);
    }

    /// When true, `can_play` panics.
    pub fn set_panic_mode(&mut self, enabled: bool) {
        self.panic_mode = enabled;
    }

    pub fn can_play(&self, account_id: AccountId) -> bool {
        if self.panic_mode {
            near_sdk::env::panic_str("mock vault panic mode");
        }
        self.overrides
            .get(&account_id)
            .copied()
            .unwrap_or(self.default_answer)
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
    #[should_panic(expected = "mock vault panic mode")]
    fn panic_mode() {
        let mut vault = MockVault::new(true);
        vault.set_panic_mode(true);
        vault.can_play(alice());
    }
}
