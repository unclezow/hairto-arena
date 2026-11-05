//! On-chain equip. `"0"` is the free default; a stored id falls back to `"0"` when its last copy leaves the account.

use near_sdk::{env, near, require, AccountId};

use crate::catalog::parse_token_id;
use crate::events::ShopEvent;
use crate::{Characters, CharactersExt};

#[near]
impl Characters {
    /// Equips `"0"` (removes the stored entry) or a character the caller holds. Works while the shop is paused.
    pub fn equip(&mut self, token_id: String) {
        let caller = env::predecessor_account_id();
        let id = parse_token_id(&token_id).unwrap_or_else(|| env::panic_str("invalid token id"));
        if id == 0 {
            self.equipped.remove(&caller);
        } else {
            require!(self.balance(id, &caller) > 0, "character not held");
            self.equipped.insert(caller.clone(), id);
        }
        ShopEvent::CharacterEquipped {
            account_id: caller,
            token_id: id.to_string(),
        }
        .emit();
    }

    /// The stored id if the account still holds it, otherwise `"0"`.
    pub fn equipped_of(&self, account_id: AccountId) -> String {
        self.equipped
            .get(&account_id)
            .copied()
            .filter(|id| self.balance(*id, &account_id) > 0)
            .unwrap_or(0)
            .to_string()
    }
}
