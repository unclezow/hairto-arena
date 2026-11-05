//! Character catalog managed by the owner. Ids start at 1; id 0 is the free default and is never listed.

use near_sdk::json_types::U128;
use near_sdk::{env, near, require};

use crate::events::ShopEvent;
use crate::{CharacterId, Characters, CharactersExt, Listing, MAX_NAME_LEN};

/// A token id is the canonical decimal string of a `u32` (`"1"`, `"2"`, …). Returns `None` for anything else.
pub fn parse_token_id(token_id: &str) -> Option<CharacterId> {
    let id: CharacterId = token_id.parse().ok()?;
    (id.to_string() == token_id).then_some(id)
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CharacterView {
    pub token_id: String,
    pub name: String,
    pub price: U128,
    /// 0 means unlimited.
    pub max_supply: u64,
    pub minted: u64,
    pub active: bool,
}

fn require_name(name: &str) {
    let len = name.chars().count();
    require!(
        (1..=MAX_NAME_LEN).contains(&len),
        "name must be 1 to 32 characters"
    );
}

#[near]
impl Characters {
    /// Owner: lists a character kind, active, with the next id. `price` in USDC base units (0 allowed),
    /// `max_supply` 0 for unlimited.
    pub fn list_character(&mut self, name: String, price: U128, max_supply: u64) -> String {
        self.assert_owner();
        require_name(&name);
        self.listings.push(Listing {
            name: name.clone(),
            price: price.0,
            max_supply,
            minted: 0,
            active: true,
        });
        let token_id = self.listings.len().to_string();
        ShopEvent::CharacterListed {
            token_id: token_id.clone(),
            name,
            price,
            max_supply,
        }
        .emit();
        token_id
    }

    /// Owner: changes the given fields. `max_supply` can never drop below the copies already minted.
    pub fn update_character(
        &mut self,
        token_id: String,
        name: Option<String>,
        price: Option<U128>,
        max_supply: Option<u64>,
        active: Option<bool>,
    ) {
        self.assert_owner();
        if let Some(name) = &name {
            require_name(name);
        }
        let id = parse_token_id(&token_id).unwrap_or_else(|| env::panic_str("invalid token id"));
        let listing = self
            .listing_mut(id)
            .unwrap_or_else(|| env::panic_str("unknown character"));
        if let Some(max) = max_supply {
            require!(
                max == 0 || max >= listing.minted,
                "max supply below minted copies"
            );
            listing.max_supply = max;
        }
        if let Some(name) = name {
            listing.name = name;
        }
        if let Some(price) = price {
            listing.price = price.0;
        }
        if let Some(active) = active {
            listing.active = active;
        }
        let l = listing.clone();
        ShopEvent::CharacterUpdated {
            token_id,
            name: l.name,
            price: U128(l.price),
            max_supply: l.max_supply,
            active: l.active,
        }
        .emit();
    }

    pub fn get_character(&self, token_id: String) -> Option<CharacterView> {
        let id = parse_token_id(&token_id)?;
        self.listing(id).map(|l| CharacterView {
            token_id,
            name: l.name.clone(),
            price: U128(l.price),
            max_supply: l.max_supply,
            minted: l.minted,
            active: l.active,
        })
    }

    pub fn get_characters(&self) -> Vec<CharacterView> {
        (1..=self.listings.len())
            .filter_map(|id| self.get_character(id.to_string()))
            .collect()
    }
}

impl Characters {
    pub(crate) fn listing(&self, id: CharacterId) -> Option<&Listing> {
        if id == 0 {
            return None;
        }
        self.listings.get(id - 1)
    }

    pub(crate) fn listing_mut(&mut self, id: CharacterId) -> Option<&mut Listing> {
        if id == 0 {
            return None;
        }
        self.listings.get_mut(id - 1)
    }
}
