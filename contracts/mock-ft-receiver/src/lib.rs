//! Test-only NEP-141 receiver. `ft_on_transfer` keeps the tokens for `msg = "accept"`, returns them all as unused
//! for `msg = "refund"`, returns half for `msg = "half"`, and panics for anything else.

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::U128;
use near_sdk::{env, near, AccountId, PanicOnDefault, PromiseOrValue};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockFtReceiver {
    received: u128,
}

#[near]
impl MockFtReceiver {
    #[init]
    pub fn new() -> Self {
        Self { received: 0 }
    }

    /// Total amount this contract kept.
    pub fn received(&self) -> U128 {
        U128(self.received)
    }
}

#[near]
impl FungibleTokenReceiver for MockFtReceiver {
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let _ = sender_id;
        let unused = match msg.as_str() {
            "accept" => 0,
            "refund" => amount.0,
            "half" => amount.0 / 2,
            _ => env::panic_str("mock receiver rejects this message"),
        };
        self.received += amount.0 - unused;
        PromiseOrValue::Value(U128(unused))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sender() -> AccountId {
        "alice.test.near".parse().unwrap()
    }

    #[test]
    fn messages() {
        let mut r = MockFtReceiver::new();
        let unused = |v: PromiseOrValue<U128>| match v {
            PromiseOrValue::Value(u) => u.0,
            PromiseOrValue::Promise(_) => panic!("no promise expected"),
        };
        assert_eq!(
            unused(r.ft_on_transfer(sender(), U128(10), "accept".into())),
            0
        );
        assert_eq!(
            unused(r.ft_on_transfer(sender(), U128(10), "refund".into())),
            10
        );
        assert_eq!(
            unused(r.ft_on_transfer(sender(), U128(10), "half".into())),
            5
        );
        assert_eq!(r.received(), U128(15));
    }

    #[test]
    #[should_panic(expected = "mock receiver rejects this message")]
    fn unknown_message_panics() {
        let _ = MockFtReceiver::new().ft_on_transfer(sender(), U128(1), "nope".into());
    }
}
