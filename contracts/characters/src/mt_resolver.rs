//! NEP-245 transfer-and-call: balances move first, the receiver's `mt_on_transfer` answers with unused amounts, and
//! the private resolver returns as much of them as the receiver still holds.

use near_sdk::json_types::U128;
use near_sdk::serde_json;
use near_sdk::{
    assert_one_yocto, env, ext_contract, near, require, AccountId, Gas, PromiseOrValue,
};

use crate::events::{MtEvent, MtTransferLog};
use crate::mt_core::{require_null_approvals, Approval};
use crate::{Characters, CharactersExt};

/// Approvals the resolver receives per token id (always `None` here, as approvals are not supported).
pub type ResolverApprovals = Option<Vec<Option<Vec<(AccountId, u64, U128)>>>>;

/// Minimum prepaid gas for a transfer-call.
pub const MIN_GAS_FOR_TRANSFER_CALL: Gas = Gas::from_tgas(50);
/// Gas reserved for `mt_resolve_transfer`.
pub const GAS_FOR_RESOLVE: Gas = Gas::from_tgas(15);

#[ext_contract(ext_mt_receiver)]
pub trait MtReceiver {
    fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>>;
}

#[near]
impl Characters {
    /// Moves one token id and calls `receiver_id.mt_on_transfer`. Needs exactly 1 yoctoNEAR and 50 Tgas.
    #[payable]
    pub fn mt_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Approval,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        require!(approval.is_none(), "approvals are not supported");
        self.transfer_call(receiver_id, vec![token_id], vec![amount], memo, msg)
    }

    /// Moves several token ids and calls `receiver_id.mt_on_transfer`. Needs exactly 1 yoctoNEAR and 50 Tgas.
    #[payable]
    pub fn mt_batch_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Approval>>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        require_null_approvals(approvals.as_deref(), token_ids.len());
        self.transfer_call(receiver_id, token_ids, amounts, memo, msg)
    }

    /// Returns to each previous owner as much of the unused amounts as the receiver still holds, then applies the
    /// equip fallback to everyone involved. A failed promise or a malformed answer means "everything unused".
    /// Returns the amounts the receiver kept.
    #[private]
    pub fn mt_resolve_transfer(
        &mut self,
        previous_owner_ids: Vec<AccountId>,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        approvals: ResolverApprovals,
    ) -> Vec<U128> {
        let _ = approvals;
        let n = token_ids.len();
        let unused: Vec<u128> = env::promise_result_checked(0, 64 * n + 16)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Vec<U128>>(&bytes).ok())
            .filter(|u| u.len() == n)
            .map(|u| u.iter().zip(&amounts).map(|(u, a)| u.0.min(a.0)).collect())
            .unwrap_or_else(|| amounts.iter().map(|a| a.0).collect());

        let mut kept = Vec::with_capacity(n);
        for (i, token_id) in token_ids.iter().enumerate() {
            let owner = &previous_owner_ids[i];
            let id = self.listed_id_or_panic(token_id);
            let refund = unused[i].min(self.balance(id, &receiver_id));
            if refund > 0 {
                self.sub_balance(id, &receiver_id, refund);
                self.add_balance(id, owner, refund);
                MtEvent::MtTransfer(vec![MtTransferLog {
                    old_owner_id: receiver_id.clone(),
                    new_owner_id: owner.clone(),
                    token_ids: vec![token_id.clone()],
                    amounts: vec![U128(refund)],
                    memo: Some("refund".to_string()),
                }])
                .emit();
            }
            kept.push(U128(amounts[i].0 - refund));
        }
        self.apply_equip_fallback(&receiver_id);
        let mut seen: Vec<&AccountId> = Vec::new();
        for owner in &previous_owner_ids {
            if !seen.contains(&owner) {
                seen.push(owner);
                self.apply_equip_fallback(owner);
            }
        }
        kept
    }
}

impl Characters {
    fn transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        assert_one_yocto();
        require!(
            env::prepaid_gas() >= MIN_GAS_FOR_TRANSFER_CALL,
            "attach at least 50 Tgas"
        );
        let sender = env::predecessor_account_id();
        // The sender's equip fallback waits for the resolver, so a refunded copy keeps it equipped.
        self.move_balances(&sender, &receiver_id, &token_ids, &amounts, memo);
        let previous_owner_ids = vec![sender.clone(); token_ids.len()];
        ext_mt_receiver::ext(receiver_id.clone())
            .with_unused_gas_weight(1)
            .mt_on_transfer(
                sender,
                previous_owner_ids.clone(),
                token_ids.clone(),
                amounts.clone(),
                msg,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_RESOLVE)
                    .with_unused_gas_weight(0)
                    .mt_resolve_transfer(previous_owner_ids, receiver_id, token_ids, amounts, None),
            )
            .into()
    }
}
