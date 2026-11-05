import { z } from 'zod';
import { ACCOUNT_ID_PATTERN as ACCOUNT_ID } from '../common/account-id.js';

const accountId = z.string().trim().toLowerCase().regex(ACCOUNT_ID, 'must be a NEAR account id');

/** An `ed25519:<base58>` secret key, as `near account export-account … using-private-key` prints it. */
const secretKey = z
  .string()
  .trim()
  .regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,100}$/, 'must be an ed25519:<base58> secret key')
  .transform((v) => v as `ed25519:${string}`);

const accountList = z
  .string()
  .default('')
  .transform((v, ctx) => {
    const items = v
      .split(',')
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean);
    const bad = items.find((a) => !ACCOUNT_ID.test(a));
    if (bad) {
      ctx.addIssue({ code: 'custom', message: `invalid account id: ${bad}` });
      return z.NEVER;
    }
    return items;
  });

/** Number of nonce lanes of a gas key (`--num-nonces` when the key was added). */
const lanes = z.coerce.number().int().min(1).max(64).default(8);

/**
 * Defaults target the local stack (docker-compose) and NEAR testnet with the ids of `deployments/testnet.json`, so
 * tests and dev run without a .env file. Keys are never defaulted.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  /**
   * Reverse proxy hops in front of the API. 0 means clients connect directly. With a proxy, set the hop count so
   * the rate limiter and the WebSocket connection cap see the client address instead of the proxy's.
   */
  TRUST_PROXY: z.coerce.number().int().nonnegative().default(0),

  DATABASE_URL: z.string().default('postgresql://hairto:hairto@localhost:5434/hairto'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  NEAR_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
  /** RPC endpoint. Defaults to the manifest's (`deployments/<network>.json`). */
  NEAR_RPC_URL: z.url().optional(),
  /** Contract ids. Each defaults to the manifest's. */
  ARENA_ID: accountId.optional(),
  VAULT_ID: accountId.optional(),
  USDC_ID: accountId.optional(),
  CHARACTERS_ID: accountId.optional(),

  /** Price pusher: a gas key limited to `arena.push_ticks`. The account defaults to the manifest's. */
  PUSHER_ACCOUNT_ID: accountId.optional(),
  PUSHER_GAS_KEY: secretKey.optional(),
  PUSHER_GAS_KEY_LANES: lanes,
  /**
   * Keeper: a function-call key on the arena (settle, reveal, prune, season methods) and, because one key serves
   * one contract, a second one on the vault (`harvest`, `flush_payouts`). The vault key defaults to the arena key.
   */
  KEEPER_ACCOUNT_ID: accountId.optional(),
  KEEPER_KEY: secretKey.optional(),
  KEEPER_VAULT_KEY: secretKey.optional(),
  /**
   * Bots: one account per level, registered in the arena with `set_bot`, each with a gas key limited to
   * `open_position`, `close_position` and `reveal_bot_seed`. A level without a gas key is not served.
   */
  BOT_LV1_ACCOUNT_ID: accountId.optional(),
  BOT_LV2_ACCOUNT_ID: accountId.optional(),
  BOT_LV3_ACCOUNT_ID: accountId.optional(),
  BOT_LV4_ACCOUNT_ID: accountId.optional(),
  BOT_LV1_GAS_KEY: secretKey.optional(),
  BOT_LV2_GAS_KEY: secretKey.optional(),
  BOT_LV3_GAS_KEY: secretKey.optional(),
  BOT_LV4_GAS_KEY: secretKey.optional(),
  BOT_GAS_KEY_LANES: lanes,
  /** Signs seed tickets only. Its public key is the arena's `bot_service_pk`; it is no account's key. */
  BOT_SERVICE_TICKET_KEY: secretKey.optional(),

  /** `hyperliquid` (free, no key), `pyth` (Hermes, needs PYTH_API_KEY) or `mock` (seeded random walk). */
  PRICE_SOURCE: z.enum(['mock', 'pyth', 'hyperliquid']).default('mock'),
  /**
   * Optional per-market sources in order of preference, overriding PRICE_SOURCE for the markets it names, e.g.
   * `GOOGL=hyperliquid;BTC=pyth,hyperliquid;XAU=pyth,hyperliquid`. A stale preferred price falls back to the next.
   */
  PRICE_SOURCES: z.string().optional(),
  HYPERLIQUID_API_URL: z.url().default('https://api.hyperliquid.xyz'),
  HYPERLIQUID_WS_URL: z.string().default('wss://api.hyperliquid.xyz/ws'),
  PYTH_HERMES_URL: z.url().default('https://hermes.pyth.network'),
  PYTH_API_KEY: z.string().optional(),

  BOT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** 32 byte key (hex) that encrypts unrevealed bot seeds at rest. Required in production. */
  BOT_SEED_ENCRYPTION_KEY: z
    .string()
    .regex(/^(0x)?[0-9a-fA-F]{64}$/, 'must be 32 bytes of hex')
    .optional(),
  /** A seed still unrevealed this long after the round is flagged and its duel is not scored. */
  BOT_REVEAL_TIMEOUT_SEC: z.coerce.number().int().positive().default(600),
  BOT_REVEAL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),

  /** Default of the runtime flag; an admin can flip it without a deploy. */
  DUELS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  DUEL_BOT_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  DUEL_SETTLE_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  /** Seconds after the round ends before the settler steps in, so fighter and bot can still finish. */
  DUEL_SETTLE_GRACE_SEC: z.coerce.number().int().nonnegative().default(5),
  /** A duel still not terminal this long after its round is reported as stuck. */
  DUEL_STUCK_AFTER_SEC: z.coerce.number().int().positive().default(300),
  /**
   * Damage model used for HP previews; the contract stays the source of truth. Must match the arena's active
   * damage configuration; previews log any disagreement.
   */
  DAMAGE_STRATEGY: z.enum(['asset-scaled', 'pnl-difference']).default('asset-scaled'),

  /** Yield rate assumed by the pot estimates on the season page, in basis points a year. */
  ESTIMATE_APY_BPS: z.coerce.number().int().positive().default(500),
  /** How Vault B splits yield: the owner share is taken from the yield after the fee, or from the gross yield. */
  VAULT_B_SPLIT_MODE: z.enum(['afterFee', 'gross']).default('afterFee'),
  /** Master switch for everything the keeper sends. Off by default: it moves money. */
  KEEPER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Compute and store results but send nothing. */
  KEEPER_DRY_RUN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  KEEPER_SEASON_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  KEEPER_HARVEST_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 1000),
  /** Skip a harvest whose estimated yield is below this (token base units): it would not cover the gas. */
  KEEPER_MIN_HARVEST_UNITS: z.coerce.bigint().nonnegative().default(1_000_000n),
  /** A Backer TWAB may differ from the chain's by this much (basis points) before the keeper refuses to post. */
  KEEPER_TWAB_TOLERANCE_BPS: z.coerce.number().int().nonnegative().default(1),
  /** The keeper refuses to compute results while the indexer lags more than this many blocks. */
  KEEPER_MAX_INDEXER_LAG_BLOCKS: z.coerce.number().int().nonnegative().default(10),
  /** Days after the dispute window before unclaimed prizes roll over. */
  KEEPER_ROLLOVER_DAYS: z.coerce.number().int().positive().default(30),
  WS_MAX_CONNECTIONS_PER_IP: z.coerce.number().int().positive().default(20),
  WS_MAX_ROOMS_PER_SOCKET: z.coerce.number().int().positive().default(10),
  /** Largest message a client may send, in bytes. */
  WS_MAX_MESSAGE_BYTES: z.coerce.number().int().positive().default(16_384),
  /** Ticks reach a client at most this often per asset; the newest one always wins. */
  WS_TICK_MIN_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  REALTIME_EVENTS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  REALTIME_EVENTS_INTERVAL_MS: z.coerce.number().int().positive().default(1000),

  PRICE_PUSHER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  PRICE_PUSH_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  /** Only the instance holding this lock pushes prices; a standby takes over when it expires. */
  PRICE_LOCK_TTL_MS: z.coerce.number().int().positive().default(5000),
  /** Gas of one `push_ticks` transaction, in Tgas: base + per asset. Unused gas is refunded. */
  PRICE_TX_TGAS_BASE: z.coerce.number().int().positive().default(30),
  PRICE_TX_TGAS_PER_ASSET: z.coerce.number().int().positive().default(5),
  /** How long a duel request keeps its asset in the on-chain push set. */
  PRICE_DEMAND_TTL_SEC: z.coerce.number().int().positive().default(30),
  /** How long the bot worker waits for a fresh on-chain tick before giving up on a ticket. */
  PRICE_PRIME_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  HERMES_POLL_MS: z.coerce.number().int().positive().default(500),
  HERMES_STREAM_RETRY_MS: z.coerce.number().int().positive().default(5000),
  MOCK_SEED: z
    .string()
    .regex(/^(0x)?[0-9a-fA-F]{64}$/)
    .default('5e'.repeat(32)),
  MOCK_BASE_PRICE: z.coerce.number().positive().default(100),
  MOCK_VOLATILITY_BPS: z.coerce.number().positive().default(2),

  /** Comma separated NEAR account ids with the `admin` role. */
  ADMIN_ACCOUNTS: accountList,
  /** App id: the NEP-413 `recipient` of the sign-in challenge, also shown in its message. */
  AUTH_DOMAIN: z.string().default('localhost'),
  NONCE_TTL_SEC: z.coerce.number().int().positive().default(300),
  SESSION_TTL_SEC: z.coerce
    .number()
    .int()
    .positive()
    .default(12 * 60 * 60),

  RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_READ_PER_WINDOW: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WRITE_PER_WINDOW: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_AUTH_PER_WINDOW: z.coerce.number().int().positive().default(20),
  /** Stricter than the general write limit: a duel takes at least 30 seconds, so more is not play. */
  RATE_LIMIT_DUEL_PER_WINDOW: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_ADMIN_PER_WINDOW: z.coerce.number().int().positive().default(30),
  /** An admin session older than this must sign in again before it can change anything. */
  ADMIN_FRESH_SIGNATURE_SEC: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60),

  /** Anti-abuse job (advisory flags, never rewards). Report only means flags are written but nothing is marked. */
  ABUSE_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  ABUSE_REPORT_ONLY: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  ABUSE_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  /** Fewer counted duels than this and a rule says nothing. */
  ABUSE_MIN_DUELS: z.coerce.number().int().positive().default(20),
  ABUSE_LV1_SHARE: z.coerce.number().min(0).max(1).default(0.8),
  ABUSE_LV1_WINRATE: z.coerce.number().min(0).max(1).default(0.95),
  ABUSE_CAP_DAYS: z.coerce.number().int().positive().default(3),
  /** Largest coefficient of variation of the gaps between duels that still counts as machine regular. */
  ABUSE_INTERVAL_CV: z.coerce.number().min(0).default(0.1),
  ABUSE_BASELINE_WINRATE: z.coerce.number().min(0).max(1).default(0.55),
  ABUSE_WINRATE_Z: z.coerce.number().positive().default(4),
  ABUSE_CYCLE_COUNT: z.coerce.number().int().positive().default(3),
  ABUSE_CYCLE_WINDOW_SEC: z.coerce.number().int().positive().default(3600),

  /** Postgres schema the indexer writes to; the read-model sync reads from it. */
  INDEXER_SCHEMA: z
    .string()
    .regex(/^[a-z_][a-z0-9_]*$/)
    .default('chain'),
  SYNC_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  SYNC_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  /** Only rows at or below `head - SYNC_FINALITY_BLOCKS` are copied (NEAR blocks are final after about 2). */
  SYNC_FINALITY_BLOCKS: z.coerce.number().int().nonnegative().default(2),
  /** Blocks re-read before the stored cursor on every run, as a guard against partial writes. */
  SYNC_REPLAY_WINDOW_BLOCKS: z.coerce.number().int().nonnegative().default(10),

  /** Readiness fails when the indexer sync is more blocks behind than this. */
  INDEXER_MAX_LAG_BLOCKS: z.coerce.number().int().nonnegative().default(50),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  // `KEY=` in a .env file means "not set" (the templates leave secrets blank), so it takes the default or stays
  // undefined instead of failing a format check.
  const present = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''));
  const result = envSchema.safeParse(present);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  if (result.data.NODE_ENV === 'production') {
    // A guessable dev key would make every unrevealed seed readable, so production must set its own.
    const problems: string[] = [];
    if (!result.data.BOT_SEED_ENCRYPTION_KEY) {
      problems.push('BOT_SEED_ENCRYPTION_KEY is required in production');
    }
    // The defaults target the local stack; none of them may reach a deployment by omission.
    if (!('PRICE_SOURCE' in present) || result.data.PRICE_SOURCE === 'mock') {
      problems.push('PRICE_SOURCE must be set to hyperliquid or pyth in production (not mock)');
    }
    if (!('NEAR_NETWORK' in present)) {
      problems.push('NEAR_NETWORK must be set to the deployed network in production');
    }
    if (!('AUTH_DOMAIN' in present) || /^localhost(:\d+)?$/.test(result.data.AUTH_DOMAIN)) {
      problems.push('AUTH_DOMAIN must be the public domain of the web app in production');
    }
    if (
      !('WEB_ORIGIN' in present) ||
      /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(result.data.WEB_ORIGIN)
    ) {
      problems.push('WEB_ORIGIN must be the public origin of the web app in production');
    }
    if (problems.length > 0) throw new Error(`Invalid environment:\n${problems.join('\n')}`);
  }
  return result.data;
}
