/** A NEAR account id (named, like `fighter.testnet`, or a 64-hex implicit id). */
export type AccountId = string;

/** Mirrors the arena `Dir`. The commit encodes Long as 1 and Short as 2; `None` is the bot's "hold". */
export enum Dir {
  None = 0,
  Long = 1,
  Short = 2,
}

/** Mirrors the arena duel `Status` by name. */
export enum DuelStatus {
  Active = 'Active',
  Finished = 'Finished',
  Forfeited = 'Forfeited',
  Voided = 'Voided',
}

/** Mirrors the vault `Pool`, which is also the account's role. 1 account = 1 role. */
export enum Role {
  Fighter = 'Fighter',
  Backer = 'Backer',
}

/** Mirrors the arena `Outcome` (from the Fighter's point of view) by name. */
export enum Outcome {
  Win = 'Win',
  Loss = 'Loss',
  Draw = 'Draw',
}

/** Mirrors the arena season `Phase` by name. `Picking` and `Finalized` are computed by the contract. */
export enum Phase {
  Picking = 'Picking',
  Active = 'Active',
  Closed = 'Closed',
  ResultsPosted = 'ResultsPosted',
  Finalized = 'Finalized',
}

/** Mirrors the arena `Side`: which player of a duel. */
export enum Side {
  Fighter = 'Fighter',
  Bot = 'Bot',
}

/** 1 Rookie, 2 Trend, 3 Reversion, 4 Oracle. */
export type BotLevel = 1 | 2 | 3 | 4;

export type OracleHealth = 'ok' | 'stale' | 'outage';

/** Socket.IO event names shared by `apps/api` (gateway) and `apps/web` (client). */
export const WS_EVENTS = {
  joinDuel: 'duel:join',
  leaveDuel: 'duel:leave',
  tick: 'price:tick',
  /** Off-chain display price for charts (Hermes), never used for settlement. */
  quote: 'price:quote',
  oracleHealth: 'price:health',
  hpUpdate: 'duel:hp',
  duelResult: 'duel:result',
  joinPrice: 'price:join',
  leavePrice: 'price:leave',
  joinSeason: 'season:join',
  leaveSeason: 'season:leave',
  duelStarted: 'duel:started',
  duelPosition: 'duel:position',
  duelVoided: 'duel:voided',
  duelSeed: 'duel:seed',
  duelSnapshot: 'duel:snapshot',
  seasonLeaderboard: 'season:leaderboard',
} as const;

/**
 * Fields every event of a duel room carries. `seq` grows by one per event of a duel, so a client that sees a
 * jump knows it missed something and can join again for a fresh snapshot. `provisional` is true while the
 * event comes straight from the chain watcher and the indexed record does not exist yet; REST is authoritative.
 */
export interface DuelEventBase {
  duelId: string;
  seq: number;
  provisional: boolean;
}

export interface DuelStartedEvent extends DuelEventBase {
  fighter: AccountId;
  botLevel: number;
  assetId: number;
  /** Round start in ms, from the arena duel `start_ms`. */
  startMs: number;
  /** Cosmetic: character the fighter has equipped (`characters.equipped_of`), 0 = default. */
  fighterCharacter: number;
  /** Cosmetic: fixed appearance of the bot for its level. */
  botCharacter: number;
}

/**
 * A position opened (no direction, it stays hidden) or closed (direction revealed by closing). A position never
 * revealed is charged a penalty by the arena at settle: it has a result but `dir` stays null.
 */
export interface DuelPositionEvent extends DuelEventBase {
  player: AccountId;
  isBot: boolean;
  state: 'opened' | 'closed';
  tick: number | null;
  dir?: Dir | null;
  /** Net PnL in ppm (1 ppm = 0.01 bps), as the arena scored it. */
  pnlPpm?: number;
  /** HP change applied to this player and to the opponent. */
  selfDelta?: number;
  opponentDelta?: number;
  penalized?: boolean;
}

export interface DuelSeedEvent extends DuelEventBase {
  /** Revealed bot seed, base64 of 32 bytes. */
  seed: string;
}

export interface DuelSnapshotEvent {
  duelId: string;
  /** The `seq` of the last event this snapshot already includes. */
  seq: number;
  status: 'created' | 'active' | 'finished' | 'forfeited' | 'voided';
  fighter: AccountId;
  botLevel: number | null;
  assetId: number;
  startMs: number | null;
  hp: { fighter: number; bot: number };
  positions: Omit<DuelPositionEvent, keyof DuelEventBase>[];
  ticks: { tickIndex: number; price: string; publishMs: number }[];
  winner: AccountId | null;
  ko: boolean;
}

export interface TickEvent {
  assetId: number;
  tickIndex: number;
  /** Price as a decimal string to avoid float precision loss. */
  price: string;
  /** Publish time in ms. */
  publishMs: number;
}

/** Off-chain display price (Pyth Hermes). Charts draw these; duels settle on on-chain ticks only. */
export interface QuoteEvent {
  assetId: number;
  /** Price as a decimal string. */
  price: string;
  /** Exponent Pyth reported the price with (price = mantissa * 10^expo). */
  expo: number;
  /** Unix ms when Pyth published this price. */
  publishMs: number;
}

/** One tradable market as `GET /markets` returns it. */
export interface MarketView {
  assetId: number;
  symbol: string;
  open: boolean;
  /** Why a closed market is closed: outside its session, disabled, or its quote is stale. */
  closedReason: 'session' | 'disabled' | 'stale' | null;
  lastPrice: string | null;
  lastPublishMs: number | null;
  /** Unix ms of the next session change (open or close); null when always open. */
  nextChangeAt: number | null;
}

export interface OracleHealthEvent {
  assetId: number;
  status: OracleHealth;
  lastPublishMs: number;
}

export interface HpUpdateEvent {
  duelId: string;
  hpFighter: number;
  hpBot: number;
  /** Only closed trades are revealed (PRD 12.2). */
  lastClosed?: {
    player: AccountId;
    dir: Dir | null;
    pnlPpm: number;
    selfDelta: number;
    opponentDelta: number;
    penalized: boolean;
  };
}

export interface DuelResultEvent {
  duelId: string;
  winner: AccountId | null;
  ko: boolean;
  pointsAwarded: number;
  /** Revealed bot seed, base64. */
  botSeed?: string;
}
