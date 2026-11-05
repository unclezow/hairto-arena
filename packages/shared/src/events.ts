/**
 * NEP-297 events of the Hairto contracts, as they appear in receipt logs:
 * `EVENT_JSON:{"standard":"hairto","version":"1.0.0","event":"<name>","data":{...}}`. Field names are the
 * contracts' snake_case. `u64` values are JSON numbers, `U128` values decimal strings, byte fields base64.
 * Sources: `contracts/arena/src/events.rs`, `contracts/vault/src/events.rs`, `contracts/characters/src/events.rs`.
 */
import type { AccountId } from './types.js';

export const HAIRTO_STANDARD = 'hairto';
export const NEP245_STANDARD = 'nep245';
export const EVENT_VERSION = '1.0.0';
export const EVENT_JSON_PREFIX = 'EVENT_JSON:';

export type SideName = 'Fighter' | 'Bot';
export type DirName = 'Long' | 'Short';
export type OutcomeName = 'Win' | 'Loss' | 'Draw';
export type PoolName = 'Fighter' | 'Backer';
export type ClaimKindName = 'Prize' | 'Bonus';

/** Arena: the duel lifecycle and price ticks. */
export interface ArenaEvents {
  ticks_pushed: {
    ticks: { asset_id: number; index: number; price: number; expo: number; publish_ms: number }[];
  };
  duel_created: {
    duel_id: number;
    fighter: AccountId;
    bot: AccountId;
    bot_level: number;
    asset_id: number;
    season: number;
    nonce: number;
    start_ms: number;
    damage_config_id: number;
  };
  duel_rejected: { fighter: AccountId; nonce: number; reason: string };
  position_opened: { duel_id: number; side: SideName; player: AccountId; open_tick: number };
  position_closed: {
    duel_id: number;
    side: SideName;
    player: AccountId;
    dir: DirName;
    close_tick: number;
    net_pnl_ppm: number;
    self_delta: number;
    opponent_delta: number;
    hp_fighter: number;
    hp_bot: number;
    ko: boolean;
  };
  position_penalized: {
    duel_id: number;
    side: SideName;
    player: AccountId;
    net_pnl_ppm: number;
    self_delta: number;
    opponent_delta: number;
    hp_fighter: number;
    hp_bot: number;
  };
  duel_finished: {
    duel_id: number;
    winner: AccountId | null;
    outcome: OutcomeName;
    ko: boolean;
    hp_fighter: number;
    hp_bot: number;
  };
  duel_forfeited: { duel_id: number; fighter: AccountId };
  duel_voided: { duel_id: number };
  bot_seed_revealed: { duel_id: number; seed: string; decisions_hash: string | null };
  /** Signed points: a loss can take points away (never below zero in the season total). */
  result_recorded: {
    season: number;
    fighter: AccountId;
    duel_id: number;
    outcome: OutcomeName;
    points: number;
  };
  duel_pruned: { duel_id: number };
  season_started: {
    season: number;
    start_ms: number;
    pick_end_ms: number;
    end_ms: number;
    asset_ids: number[];
  };
  season_ended_early: { season: number; end_ms: number };
  season_closed: { season: number; closed_ms: number };
  picked: { season: number; backer: AccountId; fighter: AccountId; backer_count: number };
  pick_rejected: { season: number; backer: AccountId; fighter: AccountId; reason: string };
  pot_funded: { season: number; amount: string; pot: string };
  results_posted: {
    season: number;
    prize_root: string;
    bonus_root: string;
    prize_total: string;
    bonus_total: string;
    claim_opens_ms: number;
  };
  results_rejected: { season: number };
  prize_claimed: { season: number; account_id: AccountId; amount: string };
  bonus_claimed: { season: number; account_id: AccountId; amount: string };
  claim_failed: {
    season: number;
    kind: ClaimKindName;
    account_id: AccountId;
    amount: string;
    credited_season: number;
  };
  season_rolled_over: { from_season: number; to_season: number; amount: string };
}

/** Vault: principal moves, yield, and harvests (accrual per pool). */
export interface VaultEvents {
  vault_registered: { account_id: AccountId };
  vault_deposited: { account_id: AccountId; pool: PoolName; amount: string; principal: string };
  vault_deposit_rejected: { account_id: AccountId; amount: string; reason: string };
  vault_withdrawn: { account_id: AccountId; pool: PoolName; amount: string; principal: string };
  vault_withdraw_failed: { account_id: AccountId; pool: PoolName; amount: string };
  vault_yield_claimed: { account_id: AccountId; amount: string };
  vault_claim_failed: { account_id: AccountId; amount: string };
  vault_harvested: {
    fighter: { fee: string; pot: string; owners: string };
    backer: { fee: string; pot: string; owners: string };
    fee: string;
    pot: string;
  };
  vault_fee_paid: { treasury_id: AccountId; amount: string };
  vault_pot_funded: { arena_id: AccountId; amount: string };
  vault_payout_failed: { kind: string; amount: string };
  vault_role_released: { account_id: AccountId; pool: PoolName };
}

/** Characters: the cosmetic NEP-245 catalog. Token ids are decimal strings. */
export interface CharacterEvents {
  character_listed: { token_id: string; name: string; price: string; max_supply: number };
  character_updated: {
    token_id: string;
    name: string;
    price: string;
    max_supply: number;
    active: boolean;
  };
  character_purchased: { buyer: AccountId; token_id: string; price: string };
  purchase_rejected: { buyer: AccountId; amount: string; reason: string };
  character_granted: { to: AccountId; token_id: string };
  character_equipped: { account_id: AccountId; token_id: string };
}

/** NEP-245 standard events of the characters contract; `data` is an array of entries. */
export interface Nep245Events {
  mt_mint: { owner_id: AccountId; token_ids: string[]; amounts: string[]; memo?: string }[];
  mt_transfer: {
    old_owner_id: AccountId;
    new_owner_id: AccountId;
    token_ids: string[];
    amounts: string[];
    memo?: string;
  }[];
}

export type HairtoEvents = ArenaEvents & VaultEvents & CharacterEvents;
export type HairtoEventName = keyof HairtoEvents;
export type Nep245EventName = keyof Nep245Events;

/** One parsed `EVENT_JSON:` log line. */
export interface Nep297Event<S extends string = string, E extends string = string, D = unknown> {
  standard: S;
  version: string;
  event: E;
  data: D;
}

/** Parses one log line; null for anything that is not a well-formed NEP-297 event. */
export function parseEventLog(log: string): Nep297Event | null {
  if (!log.startsWith(EVENT_JSON_PREFIX)) return null;
  try {
    const parsed = JSON.parse(log.slice(EVENT_JSON_PREFIX.length)) as Partial<Nep297Event>;
    if (
      typeof parsed.standard !== 'string' ||
      typeof parsed.version !== 'string' ||
      typeof parsed.event !== 'string'
    ) {
      return null;
    }
    return parsed as Nep297Event;
  } catch {
    return null;
  }
}

/**
 * Every `hairto` event name the contracts emit, per contract, including admin events the indexer only archives.
 * A test compares these lists with the event enums in the contract sources.
 */
export const CONTRACT_EVENT_NAMES = {
  arena: [
    'ticks_pushed',
    'asset_added',
    'asset_status_changed',
    'bot_configured',
    'damage_config_added',
    'damage_config_activated',
    'params_updated',
    'role_changed',
    'paused',
    'unpaused',
    'duel_created',
    'duel_rejected',
    'position_opened',
    'position_closed',
    'position_penalized',
    'duel_finished',
    'duel_forfeited',
    'duel_voided',
    'bot_seed_revealed',
    'result_recorded',
    'duel_pruned',
    'season_started',
    'season_ended_early',
    'season_closed',
    'durations_updated',
    'picked',
    'pick_rejected',
    'pot_funded',
    'pot_funding_rejected',
    'results_posted',
    'results_rejected',
    'prize_claimed',
    'bonus_claimed',
    'claim_failed',
    'season_rolled_over',
    'claims_paused',
    'claims_unpaused',
  ],
  vault: [
    'vault_registered',
    'vault_deposited',
    'vault_deposit_rejected',
    'vault_withdrawn',
    'vault_withdraw_failed',
    'vault_yield_claimed',
    'vault_claim_failed',
    'vault_harvested',
    'vault_fee_paid',
    'vault_pot_funded',
    'vault_payout_failed',
    'vault_role_released',
    'vault_config_updated',
    'vault_yield_rate_updated',
    'vault_paused',
    'vault_unpaused',
  ],
  characters: [
    'character_listed',
    'character_updated',
    'character_purchased',
    'purchase_rejected',
    'character_granted',
    'character_equipped',
    'treasury_swept',
    'treasury_sweep_failed',
    'shop_paused',
    'shop_unpaused',
    'role_changed',
  ],
} as const;
