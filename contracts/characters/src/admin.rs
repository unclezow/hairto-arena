//! Owner, roles, treasury and base URI settings, the guardian pause, and configuration views.

use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId};

use crate::events::ShopEvent;
use crate::{Characters, CharactersExt, Role};

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigView {
    pub owner_id: AccountId,
    pub token_id: AccountId,
    pub treasury_id: AccountId,
    pub base_uri: String,
    pub paused: bool,
    pub treasury_balance: U128,
    pub character_count: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RolesView {
    pub owner_id: AccountId,
    pub guardians: Vec<AccountId>,
    pub minters: Vec<AccountId>,
}

#[near]
impl Characters {
    pub fn transfer_ownership(&mut self, new_owner_id: AccountId) {
        self.assert_owner();
        self.owner_id = new_owner_id.clone();
        ShopEvent::RoleChanged {
            role: None,
            account_id: new_owner_id,
            granted: true,
        }
        .emit();
    }

    pub fn grant_role(&mut self, role: Role, account_id: AccountId) {
        self.assert_owner();
        if self.role_set_mut(role).insert(account_id.clone()) {
            ShopEvent::RoleChanged {
                role: Some(role),
                account_id,
                granted: true,
            }
            .emit();
        }
    }

    pub fn revoke_role(&mut self, role: Role, account_id: AccountId) {
        self.assert_owner();
        if self.role_set_mut(role).remove(&account_id) {
            ShopEvent::RoleChanged {
                role: Some(role),
                account_id,
                granted: false,
            }
            .emit();
        }
    }

    pub fn set_treasury(&mut self, treasury_id: AccountId) {
        self.assert_owner();
        self.treasury_id = treasury_id;
    }

    /// Owner: prefix of the metadata `reference` (for example `https://<web-host>/characters`).
    pub fn set_base_uri(&mut self, base_uri: String) {
        self.assert_owner();
        self.base_uri = base_uri;
    }

    /// Guardian: stops purchases and grants. Equip, transfers, sweep and views keep working.
    pub fn pause(&mut self) {
        self.assert_role(Role::Guardian);
        self.paused = true;
        ShopEvent::ShopPaused {
            by: env::predecessor_account_id(),
        }
        .emit();
    }

    pub fn unpause(&mut self) {
        self.assert_role(Role::Guardian);
        self.paused = false;
        ShopEvent::ShopUnpaused {
            by: env::predecessor_account_id(),
        }
        .emit();
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            owner_id: self.owner_id.clone(),
            token_id: self.token_id.clone(),
            treasury_id: self.treasury_id.clone(),
            base_uri: self.base_uri.clone(),
            paused: self.paused,
            treasury_balance: U128(self.treasury_balance),
            character_count: self.listings.len(),
        }
    }

    pub fn get_roles(&self) -> RolesView {
        RolesView {
            owner_id: self.owner_id.clone(),
            guardians: self.guardians.iter().cloned().collect(),
            minters: self.minters.iter().cloned().collect(),
        }
    }

    pub fn has_role(&self, role: Role, account_id: AccountId) -> bool {
        self.role_set(role).contains(&account_id)
    }
}

impl Characters {
    pub(crate) fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "only the owner"
        );
    }

    pub(crate) fn assert_role(&self, role: Role) {
        if !self.role_set(role).contains(&env::predecessor_account_id()) {
            env::panic_str(&format!("missing role {role:?}"));
        }
    }

    fn role_set(&self, role: Role) -> &near_sdk::store::IterableSet<AccountId> {
        match role {
            Role::Guardian => &self.guardians,
            Role::Minter => &self.minters,
        }
    }

    fn role_set_mut(&mut self, role: Role) -> &mut near_sdk::store::IterableSet<AccountId> {
        match role {
            Role::Guardian => &mut self.guardians,
            Role::Minter => &mut self.minters,
        }
    }
}
