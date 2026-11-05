//! External interface of the USDC token and the gas attached to each call.

use near_sdk::json_types::U128;
use near_sdk::{ext_contract, AccountId, Gas};

pub const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(10);
pub const GAS_FOR_MINT: Gas = Gas::from_tgas(10);
/// The token keeps ~30 Tgas for itself and `ft_resolve_transfer`; the arena gets the rest for `ft_on_transfer`.
pub const GAS_FOR_FT_TRANSFER_CALL: Gas = Gas::from_tgas(60);
/// Plain callbacks that only restore or confirm state.
pub const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(10);
/// `on_pot_minted` sends the pot with `ft_transfer_call` and its own callback.
pub const GAS_FOR_ON_POT_MINTED: Gas = Gas::from_tgas(85);
/// Minimum prepaid gas for `withdraw` and `claim_yield`.
pub const MIN_GAS_FOR_CASH_OUT: Gas = Gas::from_tgas(30);
/// Minimum prepaid gas for `harvest` and `flush_payouts`.
pub const MIN_GAS_FOR_PAYOUTS: Gas = Gas::from_tgas(150);

#[ext_contract(ext_usdc)]
pub trait Usdc {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> U128;
    fn mint(&mut self, account_id: AccountId, amount: U128, memo: Option<String>);
}
