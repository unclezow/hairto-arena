//! NEP-245 balances: helpers to read, move and mint copies. Every token id is a listed character (`"1"`, `"2"`, …).

use near_sdk::json_types::U128;
use near_sdk::{assert_one_yocto, env, near, require, AccountId};

use crate::catalog::parse_token_id;
use crate::events::{MtEvent, MtMintLog, MtTransferLog};
use crate::{CharacterId, Characters, CharactersExt};

/// NEP-245 approval argument. Approval management is not supported, so it must always be `None`.
pub type Approval = Option<(AccountId, u64)>;

#[near]
impl Characters {
    /// Moves `amount` copies of `token_id` to `receiver_id`. Needs exactly 1 yoctoNEAR; `approval` must be null.
    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Approval,
        memo: Option<String>,
    ) {
        assert_one_yocto();
        require!(approval.is_none(), "approvals are not supported");
        let sender = env::predecessor_account_id();
        self.internal_transfer(&sender, &receiver_id, &[token_id], &[amount], memo);
    }

    /// Moves several token ids at once. Needs exactly 1 yoctoNEAR; lengths must match and approvals must be null.
    #[payable]
    pub fn mt_batch_transfer(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Approval>>,
        memo: Option<String>,
    ) {
        assert_one_yocto();
        require_null_approvals(approvals.as_deref(), token_ids.len());
        let sender = env::predecessor_account_id();
        self.internal_transfer(&sender, &receiver_id, &token_ids, &amounts, memo);
    }
}

pub(crate) fn require_null_approvals(approvals: Option<&[Approval]>, len: usize) {
    if let Some(approvals) = approvals {
        require!(approvals.len() == len, "approvals length mismatch");
        require!(
            approvals.iter().all(Option::is_none),
            "approvals are not supported"
        );
    }
}

/// Why a copy cannot be minted to an account.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MintError {
    NotForSale,
    SoldOut,
    AlreadyOwned,
}

impl MintError {
    pub fn reason(self) -> &'static str {
        match self {
            MintError::NotForSale => "not_for_sale",
            MintError::SoldOut => "sold_out",
            MintError::AlreadyOwned => "already_owned",
        }
    }
}

impl Characters {
    pub(crate) fn balance(&self, id: CharacterId, account_id: &AccountId) -> u128 {
        self.balances
            .get(&(id, account_id.clone()))
            .copied()
            .unwrap_or(0)
    }

    pub(crate) fn add_balance(&mut self, id: CharacterId, account_id: &AccountId, amount: u128) {
        let next = self.balance(id, account_id) + amount;
        self.balances.insert((id, account_id.clone()), next);
    }

    /// Removes copies; an emptied balance entry is deleted so its storage is freed.
    pub(crate) fn sub_balance(&mut self, id: CharacterId, account_id: &AccountId, amount: u128) {
        let current = self.balance(id, account_id);
        if current < amount {
            env::panic_str("not enough copies");
        }
        if current == amount {
            self.balances.remove(&(id, account_id.clone()));
        } else {
            self.balances
                .insert((id, account_id.clone()), current - amount);
        }
    }

    /// A listed id (never `0`), or a failure for anything else.
    pub(crate) fn listed_id_or_panic(&self, token_id: &str) -> CharacterId {
        parse_token_id(token_id)
            .filter(|id| self.listing(*id).is_some())
            .unwrap_or_else(|| env::panic_str("unknown token id"))
    }

    /// Checks the listing, the supply and the one-copy rule for minting `id` to `to`.
    pub(crate) fn check_mint(&self, id: CharacterId, to: &AccountId) -> Result<(), MintError> {
        let listing = self
            .listing(id)
            .filter(|l| l.active)
            .ok_or(MintError::NotForSale)?;
        if listing.max_supply > 0 && listing.minted >= listing.max_supply {
            return Err(MintError::SoldOut);
        }
        if self.balance(id, to) > 0 {
            return Err(MintError::AlreadyOwned);
        }
        Ok(())
    }

    /// Mints one copy of `id` to `to` (already checked) and logs `mt_mint`.
    pub(crate) fn mint_one(&mut self, id: CharacterId, to: &AccountId, memo: &str) {
        if let Some(listing) = self.listing_mut(id) {
            listing.minted += 1;
        }
        self.add_balance(id, to, 1);
        MtEvent::MtMint(vec![MtMintLog {
            owner_id: to.clone(),
            token_ids: vec![id.to_string()],
            amounts: vec![U128(1)],
            memo: Some(memo.to_string()),
        }])
        .emit();
    }

    /// A plain (batch) transfer: moves balances, logs it, and applies the sender's equip fallback.
    pub(crate) fn internal_transfer(
        &mut self,
        sender: &AccountId,
        receiver: &AccountId,
        token_ids: &[String],
        amounts: &[U128],
        memo: Option<String>,
    ) {
        self.move_balances(sender, receiver, token_ids, amounts, memo);
        self.apply_equip_fallback(sender);
    }

    /// Checks and moves balances for a (batch) transfer and logs one `mt_transfer`. Returns the parsed ids.
    pub(crate) fn move_balances(
        &mut self,
        sender: &AccountId,
        receiver: &AccountId,
        token_ids: &[String],
        amounts: &[U128],
        memo: Option<String>,
    ) -> Vec<CharacterId> {
        require!(sender != receiver, "receiver must differ from sender");
        require!(!token_ids.is_empty(), "no token ids");
        require!(
            token_ids.len() == amounts.len(),
            "token ids and amounts length mismatch"
        );
        let mut ids = Vec::with_capacity(token_ids.len());
        for (token_id, amount) in token_ids.iter().zip(amounts) {
            let id = self.listed_id_or_panic(token_id);
            require!(amount.0 > 0, "amount must be positive");
            self.sub_balance(id, sender, amount.0);
            self.add_balance(id, receiver, amount.0);
            ids.push(id);
        }
        MtEvent::MtTransfer(vec![MtTransferLog {
            old_owner_id: sender.clone(),
            new_owner_id: receiver.clone(),
            token_ids: token_ids.to_vec(),
            amounts: amounts.to_vec(),
            memo,
        }])
        .emit();
        ids
    }
}
