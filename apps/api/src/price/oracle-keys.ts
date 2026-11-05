import type { OracleHealth } from '@hairto-arena/shared';

/** State the pusher keeps per asset so any process (and a standby pusher) can read it. */
export interface OracleState {
  status: OracleHealth;
  lastTickIndex: number | null;
  /** Unix ms of the latest tick's publish time (or of the first evaluation when no tick exists yet). */
  lastPublishMs: number;
  /** Unix ms of the chain time of the latest evaluation. */
  evaluatedAt: number;
}

/** Latest display quote of a market, as stored in Redis. */
export interface QuoteState {
  /** Decimal string. */
  price: string;
  /** Integer mantissa and exponent, as Hermes reported them. */
  mantissa: string;
  expo: number;
  /** Unix ms. */
  publishMs: number;
}

export const ORACLE_KEYS = {
  state: (assetId: number) => `oracle:state:${assetId}`,
  /** Pub/sub: verdict transitions `{ assetId, from, to, at }`. */
  statusChannel: (assetId: number) => `oracle:status:${assetId}`,
  /** Pub/sub: running duels on an asset in outage `{ assetId, duelIds, at }`. */
  voidChannel: 'oracle:void',
  voidSignaled: 'oracle:void:signaled',
  tickStream: (assetId: number) => `ticks:${assetId}`,
  pusherLock: 'price:pusher:lock',
  /** Latest Hermes quote per market, for display (JSON `QuoteState`). */
  quoteLatest: (assetId: number) => `quote:latest:${assetId}`,
  /** Capped stream of display quotes per market, for chart history. */
  quoteStream: (assetId: number) => `quotes:${assetId}`,
  quoteLock: 'price:quotes:lock',
  /** Markets whose feed id Hermes did not list at startup (a set of asset ids). */
  unverifiedFeeds: 'price:feeds:unverified',
  /** Present (with a TTL) while a duel was just requested on the asset: the pusher writes it on-chain. */
  demand: (assetId: number) => `price:demand:${assetId}`,
} as const;
