//! Test-only Season Pot receiver. `ft_on_transfer` accepts `fund_pot` transfers, returns them all as unused, or
//! panics, depending on the configured mode, and records what it kept.

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::U128;
use near_sdk::{env, near, AccountId, PanicOnDefault, PromiseOrValue};

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Accept,
    ReturnAll,
    Panic,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockArena {
    mode: Mode,
    pot_total: u128,
    fundings: u32,
}

#[near]
impl MockArena {
    #[init]
    pub fn new() -> Self {
        Self {
            mode: Mode::Accept,
            pot_total: 0,
            fundings: 0,
        }
    }

    pub fn set_mode(&mut self, mode: Mode) {
        self.mode = mode;
    }

    /// Total pot amount kept and the number of accepted `fund_pot` transfers.
    pub fn pot_received(&self) -> (U128, u32) {
        (U128(self.pot_total), self.fundings)
    }
}

#[near]
impl FungibleTokenReceiver for MockArena {
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let _ = sender_id;
        if msg != "fund_pot" {
            return PromiseOrValue::Value(amount);
        }
        match self.mode {
            Mode::Accept => {
                self.pot_total += amount.0;
                self.fundings += 1;
                PromiseOrValue::Value(U128(0))
            }
            Mode::ReturnAll => PromiseOrValue::Value(amount),
            Mode::Panic => env::panic_str("mock arena panic mode"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unused(v: PromiseOrValue<U128>) -> u128 {
        match v {
            PromiseOrValue::Value(u) => u.0,
            PromiseOrValue::Promise(_) => panic!("no promise expected"),
        }
    }

    #[test]
    fn modes() {
        let vault: AccountId = "vault.test.near".parse().unwrap();
        let mut a = MockArena::new();
        assert_eq!(
            unused(a.ft_on_transfer(vault.clone(), U128(7), "fund_pot".into())),
            0
        );
        assert_eq!(
            unused(a.ft_on_transfer(vault.clone(), U128(7), "other".into())),
            7
        );
        a.set_mode(Mode::ReturnAll);
        assert_eq!(
            unused(a.ft_on_transfer(vault, U128(5), "fund_pot".into())),
            5
        );
        assert_eq!(a.pot_received(), (U128(7), 1));
    }

    #[test]
    #[should_panic(expected = "mock arena panic mode")]
    fn panic_mode() {
        let mut a = MockArena::new();
        a.set_mode(Mode::Panic);
        let _ = a.ft_on_transfer("v.test.near".parse().unwrap(), U128(1), "fund_pot".into());
    }
}
