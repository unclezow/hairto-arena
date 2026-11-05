//! Test-only NEP-245 receiver. `mt_on_transfer` answers according to the configured mode:
//! - `KeepAll`: keeps everything (returns zeros);
//! - `ReturnAll`: returns everything as unused;
//! - `ReturnPart`: returns the first token id in full and keeps the rest;
//! - `Panic`: panics;
//! - `ForwardOn`: forwards everything it received to `forward_to` first, then reports everything as unused, so the
//!   sender's refund is limited to what this contract still holds.

use near_sdk::json_types::U128;
use near_sdk::{
    env, ext_contract, near, AccountId, Gas, NearToken, PanicOnDefault, PromiseOrValue,
};

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    KeepAll,
    ReturnAll,
    ReturnPart,
    Panic,
    ForwardOn,
}

#[ext_contract(ext_mt)]
pub trait MultiToken {
    fn mt_batch_transfer(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
    );
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockMtReceiver {
    mode: Mode,
    forward_to: Option<AccountId>,
    calls: u32,
}

#[near]
impl MockMtReceiver {
    #[init]
    pub fn new() -> Self {
        Self {
            mode: Mode::KeepAll,
            forward_to: None,
            calls: 0,
        }
    }

    /// `forward_to` is required for `ForwardOn`.
    pub fn set_mode(&mut self, mode: Mode, forward_to: Option<AccountId>) {
        self.mode = mode;
        self.forward_to = forward_to;
    }

    pub fn calls(&self) -> u32 {
        self.calls
    }

    pub fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        let _ = (sender_id, previous_owner_ids, msg);
        self.calls += 1;
        match self.mode {
            Mode::KeepAll => PromiseOrValue::Value(vec![U128(0); amounts.len()]),
            Mode::ReturnAll => PromiseOrValue::Value(amounts),
            Mode::ReturnPart => PromiseOrValue::Value(
                amounts
                    .iter()
                    .enumerate()
                    .map(|(i, a)| if i == 0 { *a } else { U128(0) })
                    .collect(),
            ),
            Mode::Panic => env::panic_str("mock receiver panic mode"),
            Mode::ForwardOn => {
                let to = self
                    .forward_to
                    .clone()
                    .unwrap_or_else(|| env::panic_str("forward_to not set"));
                let promise = ext_mt::ext(env::predecessor_account_id())
                    .with_attached_deposit(NearToken::from_yoctonear(1))
                    .with_static_gas(Gas::from_tgas(10))
                    .mt_batch_transfer(to, token_ids, amounts.clone(), None, None)
                    .then(
                        Self::ext(env::current_account_id())
                            .with_static_gas(Gas::from_tgas(5))
                            .report_all_unused(amounts),
                    );
                PromiseOrValue::Promise(promise)
            }
        }
    }

    /// Callback of the forward-on mode: claims everything is unused although it was moved on.
    #[private]
    pub fn report_all_unused(&self, amounts: Vec<U128>) -> Vec<U128> {
        amounts
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn unused(v: PromiseOrValue<Vec<U128>>) -> Vec<u128> {
        match v {
            PromiseOrValue::Value(u) => u.into_iter().map(|a| a.0).collect(),
            PromiseOrValue::Promise(_) => panic!("no promise expected"),
        }
    }

    fn call(r: &mut MockMtReceiver) -> PromiseOrValue<Vec<U128>> {
        r.mt_on_transfer(
            acc("alice.test.near"),
            vec![acc("alice.test.near"), acc("alice.test.near")],
            vec!["1".into(), "2".into()],
            vec![U128(1), U128(3)],
            String::new(),
        )
    }

    #[test]
    fn modes() {
        let mut r = MockMtReceiver::new();
        assert_eq!(unused(call(&mut r)), vec![0, 0]);
        r.set_mode(Mode::ReturnAll, None);
        assert_eq!(unused(call(&mut r)), vec![1, 3]);
        r.set_mode(Mode::ReturnPart, None);
        assert_eq!(unused(call(&mut r)), vec![1, 0]);
        r.set_mode(Mode::ForwardOn, Some(acc("bob.test.near")));
        assert!(matches!(call(&mut r), PromiseOrValue::Promise(_)));
        assert_eq!(r.calls(), 4);
    }

    #[test]
    #[should_panic(expected = "mock receiver panic mode")]
    fn panic_mode() {
        let mut r = MockMtReceiver::new();
        r.set_mode(Mode::Panic, None);
        let _ = call(&mut r);
    }
}
