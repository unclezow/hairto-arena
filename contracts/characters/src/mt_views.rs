//! NEP-245 views: tokens, balances and supply. Amounts are decimal strings; unknown ids read as nothing or zero.

use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

use crate::catalog::parse_token_id;
use crate::{CharacterId, Characters, CharactersExt};

/// A character kind as a NEP-245 token. Kinds have many copies, so `owner_id` is always null.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Token {
    pub token_id: String,
    pub owner_id: Option<AccountId>,
}

#[near]
impl Characters {
    pub fn mt_token(&self, token_ids: Vec<String>) -> Vec<Option<Token>> {
        token_ids
            .into_iter()
            .map(|token_id| {
                self.known(&token_id).map(|_| Token {
                    token_id,
                    owner_id: None,
                })
            })
            .collect()
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 {
        U128(
            self.known(&token_id)
                .map(|id| self.balance(id, &account_id))
                .unwrap_or(0),
        )
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<String>) -> Vec<U128> {
        token_ids
            .into_iter()
            .map(|t| self.mt_balance_of(account_id.clone(), t))
            .collect()
    }

    /// Minted copies, or null for an unknown id.
    pub fn mt_supply(&self, token_id: String) -> Option<U128> {
        let id = self.known(&token_id)?;
        self.listing(id).map(|l| U128(u128::from(l.minted)))
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<String>) -> Vec<Option<U128>> {
        token_ids.into_iter().map(|t| self.mt_supply(t)).collect()
    }
}

impl Characters {
    fn known(&self, token_id: &str) -> Option<CharacterId> {
        parse_token_id(token_id).filter(|id| self.listing(*id).is_some())
    }
}
