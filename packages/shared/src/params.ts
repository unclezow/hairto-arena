/**
 * Default game and economy parameters (`docs/prd.md` Bagian 16). Times are milliseconds.
 * Duel, damage, oracle and score values mirror `contracts/arena/src/params.rs`; vault values mirror the `vault`
 * contract defaults. `params.test.ts` reads the Rust file to keep them in sync.
 */

export const BPS = 10_000;

/** USDC (mock) decimals. */
export const STABLE_DECIMALS = 6;

export const DUEL = {
  rounds: 1,
  roundDurationMs: 30_000,
  /** Owner-adjustable on the arena (1 000–15 000 ms); this is the default. */
  countdownMs: 5_000,
  /** The first part of the round in which HP cannot drop below 1 (owner-adjustable, default). */
  koImmunityMs: 5_000,
  startingHp: 1000,
  /** Time after the round (or a KO) to reveal open positions, priced at the round-end tick. */
  revealGraceMs: 10_000,
  /** A bot seed revealed later than this after settlement does not score. */
  seedRevealTimeoutMs: 10 * 60_000,
  maxTradesPerDuel: 4,
  minHoldMs: 3_000,
  /** A seed ticket may be valid for at most this long. */
  ticketMaxLifetimeMs: 60_000,
  /** A pending duel whose callback never ran can be cleared after this. */
  pendingTimeoutMs: 60_000,
} as const;

/** Damage of the `PnlDifference` configuration. PnL unit is ppm: 1 ppm = 0.01 bps. */
export const DAMAGE = {
  ppmPerHp: 10,
  unrevealedBasePenaltyPpm: 100,
  paperCostPpm: 0,
} as const;

/**
 * Damage by asset (arena damage configuration 1, `AssetScaled`): HP = |net PnL bps| x the asset's HP-per-bp,
 * capped per hit.
 */
export const DAMAGE_SCALE = {
  defaultHpPerBps: 450,
  maxHitHp: 400,
  /** By asset id: 1 GOOGL, 2 BTC, 3 XAU. */
  hpPerBpsByAsset: { 1: 600, 2: 400, 3: 1500 } as Record<number, number>,
} as const;

/** HP per bp of PnL on `assetId`. */
export const hpPerBpsOf = (assetId: number) =>
  DAMAGE_SCALE.hpPerBpsByAsset[assetId] ?? DAMAGE_SCALE.defaultHpPerBps;

export const ORACLE = {
  /** Owner-adjustable on the arena (1 000–30 000 ms); this is the default. */
  maxStalenessMs: 5_000,
  voidAfterOutageMs: 10_000,
} as const;

export const SCORE = {
  pointsDraw: 0,
  maxCountedDuelsPerDay: null,
  pointsByBotLevel: {
    1: { win: [5, 10], loss: [4, 10] },
    2: { win: [8, 15], loss: [2, 7] },
    3: { win: [12, 20], loss: [1, 5] },
    4: { win: [15, 25], loss: [1, 4] },
  },
  minDuelsForLeaderboard: 10,
} as const;

export const MAX_BOT_LEVEL = 4;

export const BOT_LEVELS = {
  1: { name: 'Rookie' },
  2: { name: 'Trend' },
  3: { name: 'Reversion' },
  /** AI-driven, active only when configured on the arena. */
  4: { name: 'Oracle' },
} as const;

export const SEASON = {
  durationMs: 7 * 24 * 3_600_000,
  pickWindowMs: 24 * 3_600_000,
  disputeWindowMs: 3_600_000,
  /** Delay after season end before anyone can close it. */
  closeDelayMs: 15 * 60_000,
  /** Time after claims open before unclaimed funds roll over. */
  claimPeriodMs: 30 * 24 * 3_600_000,
  picksPerBacker: 1,
} as const;

/** Bounds the operator must respect when changing season durations (demo acceleration). */
export const SEASON_BOUNDS = {
  minDurationMs: 10 * 60_000,
  maxDurationMs: 90 * 24 * 3_600_000,
  minDisputeWindowMs: 60_000,
  maxDisputeWindowMs: 7 * 24 * 3_600_000,
  minCloseDelayMs: 60_000,
  maxCloseDelayMs: 24 * 3_600_000,
  minClaimPeriodMs: 60_000,
  maxClaimPeriodMs: 365 * 24 * 3_600_000,
} as const;

export const VAULTS = {
  fighter: {
    minDepositUsd: 10,
    feeBps: 500,
    ownerShareBps: 0,
  },
  backer: {
    minDepositUsd: 100,
    feeBps: 1000,
    /** Share of post-fee yield returned to backers [Konfirmasi]. */
    ownerShareBps: 5000,
  },
} as const;

export const POT_SPLIT = {
  fighterBps: 7500,
  backerBps: 2500,
} as const;

/**
 * Fighter prize curve, share of the fighter prize pool per rank (`docs/prd.md` Bagian 9.4).
 * Follows the table (top 20) [Konfirmasi].
 */
// prettier-ignore
export const PRIZE_CURVE_BPS: readonly number[] = [
  2500, 1700, 1300, 1000, 500, // ranks 1–5
  300, 300, 300, 300, 300, // ranks 6–10
  150, 150, 150, 150, 150, 150, 150, 150, 150, 150, // ranks 11–20
];
