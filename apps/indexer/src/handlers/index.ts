import * as character from './character.js';
import * as duel from './duel.js';
import * as score from './score.js';
import * as season from './season.js';
import type { IndexedEvent, Store } from './store.js';
import * as vault from './vault.js';

export * from './character.js';
export * from './duel.js';
export * from './score.js';
export * from './season.js';
export * from './store.js';
export * from './vault.js';

/** Which of our contracts emits an event. */
export type ContractRole = 'arena' | 'vault' | 'characters';

type Handler = (ev: IndexedEvent<never>, store: Store) => Promise<void>;

/**
 * Handler per `<standard>:<event>` and the contract allowed to emit it. Events without an entry are only archived
 * in `chain.raw_event` (admin events and the NEAR-only rejection and failure events).
 */
export const HANDLERS: Record<string, { from: ContractRole; handle: Handler }> = {
  'hairto:duel_created': { from: 'arena', handle: duel.onDuelCreated as Handler },
  'hairto:position_opened': { from: 'arena', handle: duel.onPositionOpened as Handler },
  'hairto:position_closed': { from: 'arena', handle: duel.onPositionClosed as Handler },
  'hairto:position_penalized': { from: 'arena', handle: duel.onPositionPenalized as Handler },
  'hairto:duel_finished': { from: 'arena', handle: duel.onDuelFinished as Handler },
  'hairto:duel_forfeited': { from: 'arena', handle: duel.onDuelForfeited as Handler },
  'hairto:duel_voided': { from: 'arena', handle: duel.onDuelVoided as Handler },
  'hairto:bot_seed_revealed': { from: 'arena', handle: duel.onBotSeedRevealed as Handler },
  'hairto:result_recorded': { from: 'arena', handle: score.onResultRecorded as Handler },
  'hairto:season_started': { from: 'arena', handle: season.onSeasonStarted as Handler },
  'hairto:season_ended_early': { from: 'arena', handle: season.onSeasonEndedEarly as Handler },
  'hairto:season_closed': { from: 'arena', handle: season.onSeasonClosed as Handler },
  'hairto:results_posted': { from: 'arena', handle: season.onResultsPosted as Handler },
  'hairto:results_rejected': { from: 'arena', handle: season.onResultsRejected as Handler },
  'hairto:season_rolled_over': { from: 'arena', handle: season.onSeasonRolledOver as Handler },
  'hairto:pot_funded': { from: 'arena', handle: season.onPotFunded as Handler },
  'hairto:prize_claimed': { from: 'arena', handle: season.onPrizeClaimed as Handler },
  'hairto:bonus_claimed': { from: 'arena', handle: season.onBonusClaimed as Handler },
  'hairto:picked': { from: 'arena', handle: vault.onPicked as Handler },
  'hairto:vault_deposited': { from: 'vault', handle: vault.onDeposited as Handler },
  'hairto:vault_withdrawn': { from: 'vault', handle: vault.onWithdrawn as Handler },
  'hairto:vault_yield_claimed': { from: 'vault', handle: vault.onYieldClaimed as Handler },
  'hairto:vault_harvested': { from: 'vault', handle: vault.onHarvested as Handler },
  'hairto:character_listed': { from: 'characters', handle: character.onCharacterListed as Handler },
  'hairto:character_updated': {
    from: 'characters',
    handle: character.onCharacterUpdated as Handler,
  },
  'hairto:character_purchased': {
    from: 'characters',
    handle: character.onCharacterPurchased as Handler,
  },
  'hairto:character_granted': {
    from: 'characters',
    handle: character.onCharacterGranted as Handler,
  },
  'hairto:character_equipped': {
    from: 'characters',
    handle: character.onCharacterEquipped as Handler,
  },
  'nep245:mt_mint': { from: 'characters', handle: character.onMtMint as Handler },
  'nep245:mt_transfer': { from: 'characters', handle: character.onMtTransfer as Handler },
};
