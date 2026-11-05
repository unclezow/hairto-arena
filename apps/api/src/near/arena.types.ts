/**
 * JSON shapes of the arena contract (`contracts/arena/src/types.rs`), snake_case exactly as the contract serializes
 * them. `u64` values are JSON numbers, `U128` values decimal strings, byte fields base64.
 */
import type { AccountId, BotLevel } from '@hairto-arena/shared';

export type DuelStatusName = 'Active' | 'Finished' | 'Forfeited' | 'Voided';
export type OutcomeName = 'Win' | 'Loss' | 'Draw';
export type SideName = 'Fighter' | 'Bot';
export type PhaseName = 'Picking' | 'Active' | 'Closed' | 'ResultsPosted' | 'Finalized';
export type DirName = 'Long' | 'Short';
export type ClaimKindName = 'Prize' | 'Bonus';

export interface ArenaConfigView {
  owner_id: AccountId;
  vault_id: AccountId;
  paused: boolean;
  countdown_ms: number;
  ko_immunity_ms: number;
  max_staleness_ms: number;
  ring_size: number;
  active_damage_config: number;
  next_duel_id: number;
  current_season: number;
  claims_paused: boolean;
  token_id: AccountId | null;
  total_pots: string;
}

export interface AssetView {
  asset_id: number;
  /** 64 hex characters. */
  feed_id: string;
  symbol: string;
  active: boolean;
}

export interface BotView {
  level: BotLevel;
  account_id: AccountId;
  active: boolean;
}

export interface TickView {
  index: number;
  price: number;
  expo: number;
  publish_ms: number;
}

export interface TickInput {
  asset_id: number;
  price: number;
  expo: number;
  publish_ms: number;
}

/** A seed ticket as `start_duel` takes it. */
export interface SeedTicketJson {
  fighter: AccountId;
  asset_id: number;
  bot_level: BotLevel;
  /** Base64, 32 bytes. */
  seed_hash: string;
  nonce: number;
  deadline_ms: number;
}

export type ActiveSlot =
  { Pending: { nonce: number; since_ms: number } } | { Active: { duel_id: number } };

export interface DuelView {
  duel_id: number;
  fighter: AccountId;
  bot: AccountId;
  asset_id: number;
  bot_level: BotLevel;
  season: number;
  nonce: number;
  start_ms: number;
  end_ms: number;
  effective_end_ms: number;
  ko_ms: number | null;
  hp_fighter: number;
  hp_bot: number;
  /** Base64, 32 bytes. */
  seed_hash: string;
  status: DuelStatusName;
  outcome: OutcomeName | null;
  winner: AccountId | null;
  ko: boolean;
  damage_config_id: number;
  ko_immunity_ms: number;
  settled_ms: number | null;
}

export interface PositionView {
  /** Base64, 32 bytes. */
  commit: string;
  open_tick: number;
  open_ms: number;
  open: boolean;
  trades: number;
  score_ppm: number;
  damage_dealt: number;
}

export interface SeasonResultsView {
  prize_root: string;
  bonus_root: string;
  prize_total: string;
  bonus_total: string;
  prize_claimed: string;
  bonus_claimed: string;
  pot_at_post: string;
  results_posted_ms: number;
  claim_opens_ms: number;
  rolled_over: boolean;
}

export interface SeasonView {
  season: number;
  phase: PhaseName;
  start_ms: number;
  pick_end_ms: number;
  end_ms: number;
  closed_ms: number | null;
  close_delay_ms: number;
  dispute_window_ms: number;
  claim_period_ms: number;
  asset_ids: number[];
  pot: string;
  results: SeasonResultsView | null;
}

export interface Durations {
  season_duration_ms: number;
  pick_window_ms: number;
  dispute_window_ms: number;
  close_delay_ms: number;
  claim_period_ms: number;
}

export interface ScoreView {
  points: number;
  duels: number;
  wins: number;
  reached_at_ms: number;
}

export type DamageConfigView =
  | {
      AssetScaled: {
        paper_cost_ppm: number;
        default_hp_per_bps: number;
        max_hit_hp: number;
        hp_per_bps: [number, number][];
      };
    }
  | { PnlDifference: { ppm_per_hp: number; paper_cost_ppm: number } };
