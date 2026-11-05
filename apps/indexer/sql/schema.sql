-- Schema `chain`, written by apps/indexer and read by the API sync (`INDEXER_SCHEMA`).
-- Generated from apps/indexer/src/db/tables.ts; the indexer runs it at start.
CREATE SCHEMA IF NOT EXISTS chain;

CREATE TABLE IF NOT EXISTS chain.indexer_cursor (
  name text PRIMARY KEY,
  block_height bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Every accepted event, also those without a handler, for audit and replay.
CREATE TABLE IF NOT EXISTS chain.raw_event (
  block_height bigint NOT NULL,
  log_index integer NOT NULL,
  block_timestamp_ms bigint NOT NULL,
  receipt_id text NOT NULL,
  tx_hash text,
  executor text NOT NULL,
  standard text NOT NULL,
  version text NOT NULL,
  event text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (block_height, log_index)
);
CREATE INDEX IF NOT EXISTS raw_event_event_idx ON chain.raw_event (event);

CREATE TABLE IF NOT EXISTS chain."duel" (
  "id" bigint NOT NULL,
  "fighter" text NOT NULL,
  "bot" text NOT NULL,
  "bot_level" integer NOT NULL,
  "asset_id" bigint NOT NULL,
  "season" bigint,
  "nonce" bigint,
  "start_ms" bigint,
  "status" text NOT NULL,
  "winner" text,
  "ko" boolean,
  "hp_fighter" integer,
  "hp_bot" integer,
  "created_at" bigint NOT NULL,
  "finished_at" bigint,
  "bot_seed" text,
  "outcome" text,
  "points_awarded" bigint,
  "counted" boolean,
  "block_height" bigint NOT NULL,
  "log_index" integer NOT NULL,
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "duel_position_idx" ON chain."duel" (block_height, log_index);

CREATE TABLE IF NOT EXISTS chain."position" (
  "id" text NOT NULL,
  "duel_id" bigint NOT NULL,
  "player" text NOT NULL,
  "dir" integer,
  "pnl_ppm" integer,
  "self_delta" integer,
  "opponent_delta" integer,
  "penalized" boolean,
  "open_tick" bigint,
  "close_tick" bigint,
  "opened_at" bigint,
  "closed_at" bigint,
  "block_height" bigint NOT NULL,
  "log_index" integer NOT NULL,
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "position_position_idx" ON chain."position" (block_height, log_index);

CREATE TABLE IF NOT EXISTS chain."duel_tx" (
  "id" text NOT NULL,
  "duel_id" bigint NOT NULL,
  "kind" text NOT NULL,
  "player" text,
  "tx_hash" text NOT NULL,
  "dir" integer,
  "pnl_ppm" integer,
  "self_delta" integer,
  "opponent_delta" integer,
  "timestamp" bigint NOT NULL,
  "block_height" bigint NOT NULL,
  "log_index" integer NOT NULL,
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "duel_tx_position_idx" ON chain."duel_tx" (block_height, log_index);

CREATE TABLE IF NOT EXISTS chain."open_position" (
  "id" text NOT NULL,
  "position_id" text NOT NULL,
  "block_height" bigint NOT NULL,
  "log_index" integer NOT NULL,
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "open_position_position_idx" ON chain."open_position" (block_height, log_index);

CREATE TABLE IF NOT EXISTS chain."fighter_score" (
  "season" bigint NOT NULL,
  "fighter" text NOT NULL,
  "points" bigint NOT NULL,
  "duels" integer NOT NULL,
  "wins" integer NOT NULL,
  "reached_at" bigint NOT NULL,
  "block_height" bigint NOT NULL,
  "log_index" integer NOT NULL,
  PRIMARY KEY ("season", "fighter")
);
CREATE INDEX IF NOT EXISTS "fighter_score_position_idx" ON chain."fighter_score" (block_height, log_index);

CREATE TABLE IF NOT EXISTS chain."vault_event" (
  "id" text NOT NULL,
  "pool" text NOT NULL,
  "account" text NOT NULL,
  "kind" text NOT NULL,
  "amount" numeric(78, 0) NOT NULL,
  "timestamp" bigint NOT NULL,
  "tx_hash" text NOT NULL,
  "block_height" bigint NOT NULL,
  "log_index" integer NOT NULL,
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "vault_event_position_idx" ON chain."vault_event" (block_height, log_index);

CREATE TABLE IF NOT EXISTS chain."harvest" (
  "id" text NOT NULL,
  "pool" text NOT NULL,
  "season" bigint,
  "gross_yield" numeric(78, 0) NOT NULL,
  "fee" numeric(78, 0) NOT NULL,
  "to_pot" numeric(78, 0) NOT NULL,
  "to_owners" numeric(78, 0) NOT NULL,
  "timestamp" bigint NOT NULL,
  "tx_hash" text NOT NULL,
  "block_height" bigint NOT NULL,
  "log_index" integer NOT NULL,
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "harvest_position_idx" ON chain."harvest" (block_height, log_index);

CREATE TABLE IF NOT EXISTS chain."pick" (
  "season" bigint NOT NULL,
  "backer" text NOT NULL,
  "fighter" text NOT NULL,
  "timestamp" bigint NOT NULL,
  "block_height" bigint NOT NULL,
  "log_index" integer NOT NULL,
  PRIMARY KEY ("season", "backer")
);
CREATE INDEX IF NOT EXISTS "pick_position_idx" ON chain."pick" (block_height, log_index);

CREATE TABLE IF NOT EXISTS chain."season" (
  "id" bigint NOT NULL,
  "start_ms" bigint NOT NULL,
  "pick_end_ms" bigint,
  "end_ms" bigint NOT NULL,
  "phase" text NOT NULL,
  "prize_root" text,
  "bonus_root" text,
  "prize_total" numeric(78, 0),
  "bonus_total" numeric(78, 0),
  "results_posted_at" bigint,
  "claim_opens_ms" bigint,
  "rolled_over_amount" numeric(78, 0),
  "pot" numeric(78, 0),
  "block_height" bigint NOT NULL,
  "log_index" integer NOT NULL,
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "season_position_idx" ON chain."season" (block_height, log_index);

CREATE TABLE IF NOT EXISTS chain."claim" (
  "id" text NOT NULL,
  "season" bigint NOT NULL,
  "account" text NOT NULL,
  "kind" text NOT NULL,
  "amount" numeric(78, 0) NOT NULL,
  "timestamp" bigint NOT NULL,
  "tx_hash" text NOT NULL,
  "block_height" bigint NOT NULL,
  "log_index" integer NOT NULL,
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "claim_position_idx" ON chain."claim" (block_height, log_index);

CREATE TABLE IF NOT EXISTS chain."global_stat" (
  "id" text NOT NULL,
  "total_duels" integer NOT NULL,
  "finished_duels" integer NOT NULL,
  "forfeited_duels" integer NOT NULL,
  "voided_duels" integer NOT NULL,
  "block_height" bigint NOT NULL,
  "log_index" integer NOT NULL,
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "global_stat_position_idx" ON chain."global_stat" (block_height, log_index);

CREATE TABLE IF NOT EXISTS chain."character" (
  "id" bigint NOT NULL,
  "price" numeric(78, 0) NOT NULL,
  "max_supply" integer NOT NULL,
  "minted" integer NOT NULL,
  "active" boolean NOT NULL,
  "block_height" bigint NOT NULL,
  "log_index" integer NOT NULL,
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "character_position_idx" ON chain."character" (block_height, log_index);

CREATE TABLE IF NOT EXISTS chain."character_balance" (
  "account" text NOT NULL,
  "character_id" bigint NOT NULL,
  "amount" numeric(78, 0) NOT NULL,
  "block_height" bigint NOT NULL,
  "log_index" integer NOT NULL,
  PRIMARY KEY ("account", "character_id")
);
CREATE INDEX IF NOT EXISTS "character_balance_position_idx" ON chain."character_balance" (block_height, log_index);

CREATE TABLE IF NOT EXISTS chain."character_equipped" (
  "account" text NOT NULL,
  "character_id" bigint NOT NULL,
  "block_height" bigint NOT NULL,
  "log_index" integer NOT NULL,
  PRIMARY KEY ("account")
);
CREATE INDEX IF NOT EXISTS "character_equipped_position_idx" ON chain."character_equipped" (block_height, log_index);

CREATE TABLE IF NOT EXISTS chain."character_equip_event" (
  "id" text NOT NULL,
  "account" text NOT NULL,
  "character_id" bigint NOT NULL,
  "timestamp" bigint NOT NULL,
  "block_height" bigint NOT NULL,
  "log_index" integer NOT NULL,
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "character_equip_event_position_idx" ON chain."character_equip_event" (block_height, log_index);

CREATE TABLE IF NOT EXISTS chain."character_purchase" (
  "id" text NOT NULL,
  "account" text NOT NULL,
  "character_id" bigint NOT NULL,
  "kind" text NOT NULL,
  "price" numeric(78, 0) NOT NULL,
  "timestamp" bigint NOT NULL,
  "tx_hash" text NOT NULL,
  "block_height" bigint NOT NULL,
  "log_index" integer NOT NULL,
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "character_purchase_position_idx" ON chain."character_purchase" (block_height, log_index);
