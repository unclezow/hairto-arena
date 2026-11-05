/** API refusals of a duel request, in the words of the battle popups. */
const START_ERRORS: Record<string, string> = {
  DUELS_DISABLED: 'New duels are paused. Try again later.',
  ARENA_CLOSED: 'The market is closed. Try again later.',
  ORACLE_UNAVAILABLE: 'The price feed is not ready. Try again in a moment.',
  DUEL_IN_PROGRESS: 'A duel is still running.',
  BOT_UNAVAILABLE: 'The bot is resting. Try again.',
  NO_ACTIVE_SEASON: 'No season is open right now.',
  SEASON_NOT_OPEN: 'No season is open right now.',
  SIGN_DECLINED: 'You declined the transaction. Try again when you are ready.',
  BELOW_MINIMUM_DEPOSIT: 'Deposit at least 10 USDC to play.',
  NOT_ELIGIBLE: 'Deposit at least 10 USDC to play.',
  VAULT_ERROR: 'The vault did not answer. Try again.',
  DUEL_REJECTED: 'The arena refused the duel. Try again.',
  UNAUTHENTICATED: 'Sign in again to start a duel.',
};

export const startErrorText = (code: string) =>
  START_ERRORS[code] ?? 'Something went wrong. Try again.';
