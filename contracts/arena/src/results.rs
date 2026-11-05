//! Season results (merkle roots and totals posted by the keeper), guardian rejection, prize and bonus claims paid in
//! USDC, and rollover of unclaimed funds.

use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::{
    env, ext_contract, is_promise_success, near, require, AccountId, NearToken, Promise,
};

use crate::duel::bytes32;
use crate::events::ArenaEvent;
use crate::merkle::{leaf_hash, verify};
use crate::params::{
    BONUS_CAP_BPS, BPS, GAS_FOR_FT_TRANSFER, GAS_FOR_ON_CLAIM, MIN_GAS_FOR_CLAIM, PRIZE_CAP_BPS,
};
use crate::types::{ClaimKind, Hash32, Phase, Role, SeasonId, SeasonResults};
use crate::{Arena, ArenaExt};

#[ext_contract(ext_token)]
pub trait Token {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

const ZERO_ROOT: Hash32 = [0u8; 32];

#[near]
impl Arena {
    /// Keeper: posts the prize and bonus merkle roots of a closed season. `prize_total` may use at most 75% of the
    /// pot and `bonus_total` at most 25%; a root is all zeros exactly when its total is zero. Claims open after the
    /// season's dispute window.
    pub fn post_results(
        &mut self,
        season: SeasonId,
        prize_root: Base64VecU8,
        bonus_root: Base64VecU8,
        prize_total: U128,
        bonus_total: U128,
    ) {
        self.assert_role(Role::Keeper);
        let prize_root = bytes32(&prize_root, "prize_root");
        let bonus_root = bytes32(&bonus_root, "bonus_root");
        let s = self
            .seasons
            .get(&season)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown season"));
        require!(s.phase == Phase::Closed, "season not closed");
        let pot = self.pot_amount(season);
        require!(
            prize_total.0 <= pot * PRIZE_CAP_BPS / BPS,
            "prize total above 75% of the pot"
        );
        require!(
            bonus_total.0 <= pot * BONUS_CAP_BPS / BPS,
            "bonus total above 25% of the pot"
        );
        require!(
            (prize_root == ZERO_ROOT) == (prize_total.0 == 0),
            "prize root must be zero exactly when the total is zero"
        );
        require!(
            (bonus_root == ZERO_ROOT) == (bonus_total.0 == 0),
            "bonus root must be zero exactly when the total is zero"
        );
        let now = Self::now_ms();
        let claim_opens_ms = now + s.dispute_window_ms;
        self.season_results.insert(
            season,
            SeasonResults {
                prize_root,
                bonus_root,
                prize_total: prize_total.0,
                bonus_total: bonus_total.0,
                prize_claimed: 0,
                bonus_claimed: 0,
                pot_at_post: pot,
                results_posted_ms: now,
                claim_opens_ms,
                rolled_over: false,
            },
        );
        if let Some(stored) = self.seasons.get_mut(&season) {
            stored.phase = Phase::ResultsPosted;
        }
        ArenaEvent::ResultsPosted {
            season,
            prize_root: Base64VecU8(prize_root.to_vec()),
            bonus_root: Base64VecU8(bonus_root.to_vec()),
            prize_total,
            bonus_total,
            claim_opens_ms,
        }
        .emit();
    }

    /// Guardian: rejects posted results during the dispute window; the season returns to `Closed`.
    pub fn reject_results(&mut self, season: SeasonId) {
        self.assert_role(Role::Guardian);
        require!(
            self.phase_of(season) == Some(Phase::ResultsPosted),
            "no results in dispute"
        );
        self.season_results.remove(&season);
        if let Some(stored) = self.seasons.get_mut(&season) {
            stored.phase = Phase::Closed;
        }
        ArenaEvent::ResultsRejected { season }.emit();
    }

    /// Pays the caller's Fighter prize for `season` in USDC. No deposit needed: funds only go to the caller.
    pub fn claim_prize(
        &mut self,
        season: SeasonId,
        amount: U128,
        proof: Vec<Base64VecU8>,
    ) -> Promise {
        self.claim(season, ClaimKind::Prize, amount, proof)
    }

    /// Pays the caller's Backer bonus for `season` in USDC. No deposit needed: funds only go to the caller.
    pub fn claim_bonus(
        &mut self,
        season: SeasonId,
        amount: U128,
        proof: Vec<Base64VecU8>,
    ) -> Promise {
        self.claim(season, ClaimKind::Bonus, amount, proof)
    }

    /// Reverses a claim whose USDC transfer failed. If the season rolled over meanwhile, the amount goes to the
    /// funding season instead.
    #[private]
    pub fn on_claim_transferred(
        &mut self,
        season: SeasonId,
        kind: ClaimKind,
        account_id: AccountId,
        amount: U128,
    ) {
        if is_promise_success() {
            return;
        }
        self.claimed.remove(&(season, kind, account_id.clone()));
        let mut credited_season = season;
        if let Some(r) = self.season_results.get_mut(&season) {
            match kind {
                ClaimKind::Prize => r.prize_claimed -= amount.0,
                ClaimKind::Bonus => r.bonus_claimed -= amount.0,
            }
            if r.rolled_over {
                credited_season = 0;
            }
        }
        if credited_season == 0 {
            credited_season = self.funding_season();
        }
        self.credit_pot(credited_season, amount.0);
        ArenaEvent::ClaimFailed {
            season,
            kind,
            account_id,
            amount,
            credited_season,
        }
        .emit();
    }

    /// Anyone: after the claim period, moves what is left of the season's pot to the funding season.
    pub fn rollover_unclaimed(&mut self, season: SeasonId) {
        require!(
            self.phase_of(season) == Some(Phase::Finalized),
            "season not finalized"
        );
        let claim_period_ms = self
            .seasons
            .get(&season)
            .map(|s| s.claim_period_ms)
            .unwrap_or_else(|| env::abort());
        let results = self
            .season_results
            .get(&season)
            .cloned()
            .unwrap_or_else(|| env::abort());
        require!(!results.rolled_over, "already rolled over");
        require!(
            Self::now_ms() >= results.claim_opens_ms + claim_period_ms,
            "claim period not over"
        );
        let to_season = self.funding_season();
        let amount = self.pot_amount(season);
        if amount > 0 {
            self.debit_pot(season, amount);
            self.credit_pot(to_season, amount);
        }
        if let Some(r) = self.season_results.get_mut(&season) {
            r.rolled_over = true;
        }
        ArenaEvent::SeasonRolledOver {
            from_season: season,
            to_season,
            amount: U128(amount),
        }
        .emit();
    }

    pub fn is_claimed(&self, season: SeasonId, kind: ClaimKind, account_id: AccountId) -> bool {
        self.claimed.contains(&(season, kind, account_id))
    }

    /// `keccak256(keccak256(borsh((account_id, amount))))`, the leaf the keeper puts in the tree.
    pub fn leaf_of(&self, account_id: AccountId, amount: U128) -> Base64VecU8 {
        Base64VecU8(leaf_hash(account_id.as_str(), amount.0).to_vec())
    }
}

impl Arena {
    fn claim(
        &mut self,
        season: SeasonId,
        kind: ClaimKind,
        amount: U128,
        proof: Vec<Base64VecU8>,
    ) -> Promise {
        require!(
            env::prepaid_gas() >= MIN_GAS_FOR_CLAIM,
            "attach at least 30 Tgas"
        );
        let token = self
            .token_id
            .clone()
            .unwrap_or_else(|| env::panic_str("token id not set"));
        require!(!self.claims_paused, "claims paused");
        require!(
            self.phase_of(season) == Some(Phase::Finalized),
            "season not finalized"
        );
        let caller = env::predecessor_account_id();
        let key = (season, kind, caller.clone());
        require!(!self.claimed.contains(&key), "already claimed");
        require!(amount.0 > 0, "amount must be positive");
        let proof: Vec<Hash32> = proof.iter().map(|p| bytes32(p, "proof node")).collect();

        let results = self
            .season_results
            .get_mut(&season)
            .unwrap_or_else(|| env::abort());
        require!(!results.rolled_over, "season rolled over");
        let (root, claimed, total) = match kind {
            ClaimKind::Prize => (
                results.prize_root,
                &mut results.prize_claimed,
                results.prize_total,
            ),
            ClaimKind::Bonus => (
                results.bonus_root,
                &mut results.bonus_claimed,
                results.bonus_total,
            ),
        };
        require!(
            verify(&proof, &root, leaf_hash(caller.as_str(), amount.0)),
            "invalid proof"
        );
        require!(
            *claimed + amount.0 <= total,
            "claims exceed the posted total"
        );
        *claimed += amount.0;

        self.claimed.insert(key);
        self.debit_pot(season, amount.0);
        match kind {
            ClaimKind::Prize => ArenaEvent::PrizeClaimed {
                season,
                account_id: caller.clone(),
                amount,
            },
            ClaimKind::Bonus => ArenaEvent::BonusClaimed {
                season,
                account_id: caller.clone(),
                amount,
            },
        }
        .emit();

        ext_token::ext(token)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(
                caller.clone(),
                amount,
                Some(format!("season {season} payout")),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_ON_CLAIM)
                    .on_claim_transferred(season, kind, caller, amount),
            )
    }
}
