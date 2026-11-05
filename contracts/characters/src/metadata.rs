//! NEP-245 metadata views (read only; the metadata extension is still marked subject to change). Each token's
//! `reference` is `<id>.json` under the owner-set `base_uri`, which the web app serves.

use near_sdk::json_types::Base64VecU8;
use near_sdk::near;

use crate::catalog::parse_token_id;
use crate::{Characters, CharactersExt};

pub const MT_METADATA_SPEC: &str = "mt-1.0.0";
pub const CONTRACT_NAME: &str = "Hairto Arena Characters";

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MtContractMetadata {
    pub spec: String,
    pub name: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MtBaseTokenMetadata {
    pub id: String,
    pub name: String,
    pub symbol: Option<String>,
    pub icon: Option<String>,
    pub decimals: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    /// Max supply, or null when unlimited.
    pub copies: Option<u64>,
    pub reference_hash: Option<Base64VecU8>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MtTokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub media: Option<String>,
    pub media_hash: Option<Base64VecU8>,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
    pub starts_at: Option<String>,
    pub updated_at: Option<String>,
    pub extra: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<Base64VecU8>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MtTokenMetadataAll {
    pub base: MtBaseTokenMetadata,
    pub token: MtTokenMetadata,
}

#[near]
impl Characters {
    pub fn mt_metadata_contract(&self) -> MtContractMetadata {
        MtContractMetadata {
            spec: MT_METADATA_SPEC.to_string(),
            name: CONTRACT_NAME.to_string(),
        }
    }

    pub fn mt_metadata_base_by_token_id(
        &self,
        token_ids: Vec<String>,
    ) -> Vec<Option<MtBaseTokenMetadata>> {
        token_ids.iter().map(|t| self.base_metadata(t)).collect()
    }

    pub fn mt_metadata_token_by_token_id(
        &self,
        token_ids: Vec<String>,
    ) -> Vec<Option<MtTokenMetadata>> {
        token_ids.iter().map(|t| self.token_metadata(t)).collect()
    }

    pub fn mt_metadata_token_all(&self, token_ids: Vec<String>) -> Vec<Option<MtTokenMetadataAll>> {
        token_ids
            .iter()
            .map(|t| {
                Some(MtTokenMetadataAll {
                    base: self.base_metadata(t)?,
                    token: self.token_metadata(t)?,
                })
            })
            .collect()
    }
}

impl Characters {
    fn base_metadata(&self, token_id: &str) -> Option<MtBaseTokenMetadata> {
        let id = parse_token_id(token_id)?;
        let listing = self.listing(id)?;
        Some(MtBaseTokenMetadata {
            id: token_id.to_string(),
            name: listing.name.clone(),
            symbol: None,
            icon: None,
            decimals: None,
            base_uri: Some(self.base_uri.clone()),
            reference: Some(format!("{token_id}.json")),
            copies: (listing.max_supply > 0).then_some(listing.max_supply),
            reference_hash: None,
        })
    }

    fn token_metadata(&self, token_id: &str) -> Option<MtTokenMetadata> {
        let id = parse_token_id(token_id)?;
        let listing = self.listing(id)?;
        Some(MtTokenMetadata {
            title: Some(listing.name.clone()),
            ..MtTokenMetadata::default()
        })
    }
}
