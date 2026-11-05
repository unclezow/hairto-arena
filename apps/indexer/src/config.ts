import { getDeployment, withOverrides, type NearNetwork } from '@hairto-arena/shared';
import type { ContractIds } from './decode.js';

export interface IndexerConfig {
  nodeEnv: string;
  databaseUrl: string;
  redisUrl: string;
  schema: string;
  contracts: ContractIds;
  startBlock: number;
  neardataUrl: string;
  neardataApiKey?: string;
  maxRpm: number;
  txApiUrl: string;
  gapFillThreshold: number;
  gapFillSafety: number;
  resetToHead: boolean;
  waitMs: number;
}

const DEFAULT_NEARDATA: Record<NearNetwork, string> = {
  testnet: 'https://testnet.neardata.xyz',
  mainnet: 'https://mainnet.neardata.xyz',
};
const DEFAULT_TX_API: Record<NearNetwork, string> = {
  testnet: 'https://tx.test.fastnear.com',
  mainnet: 'https://tx.main.fastnear.com',
};

function int(env: Record<string, string | undefined>, name: string, fallback?: number): number {
  const raw = env[name]?.trim();
  if (!raw) {
    if (fallback === undefined) throw new Error(`${name} is required`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number`);
  return value;
}

/** Reads the environment; contract ids default to `deployments/<network>.json`. */
export function loadConfig(env: Record<string, string | undefined> = process.env): IndexerConfig {
  const network = (env.NEAR_NETWORK?.trim() || 'testnet') as NearNetwork;
  if (network !== 'testnet' && network !== 'mainnet')
    throw new Error('NEAR_NETWORK must be testnet or mainnet');
  const deployment = withOverrides(getDeployment(network), env);
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const resetToHead = env.INDEXER_RESET_TO_HEAD?.trim() === 'true';
  if (resetToHead && nodeEnv === 'production') {
    throw new Error('INDEXER_RESET_TO_HEAD is refused in production: it skips blocks for good');
  }
  const schema = env.INDEXER_SCHEMA?.trim() || 'chain';
  if (!/^[a-z_][a-z0-9_]*$/.test(schema))
    throw new Error('INDEXER_SCHEMA must be a plain identifier');
  const maxRpm = int(env, 'NEARDATA_MAX_RPM', 150);
  if (maxRpm < 1 || maxRpm > 180) throw new Error('NEARDATA_MAX_RPM must be between 1 and 180');

  return {
    nodeEnv,
    databaseUrl: env.DATABASE_URL?.trim() || 'postgresql://hairto:hairto@localhost:5434/hairto',
    redisUrl: env.REDIS_URL?.trim() || 'redis://localhost:6379',
    schema,
    contracts: {
      arena: deployment.contracts.arena,
      vault: deployment.contracts.vault,
      characters: deployment.contracts.characters,
    },
    startBlock: int(env, 'INDEXER_START_BLOCK', deployment.startBlock ?? undefined),
    neardataUrl: env.NEARDATA_URL?.trim() || DEFAULT_NEARDATA[network],
    neardataApiKey: env.NEARDATA_API_KEY?.trim() || undefined,
    maxRpm,
    txApiUrl: env.TX_API_URL?.trim() || DEFAULT_TX_API[network],
    gapFillThreshold: int(env, 'GAP_FILL_THRESHOLD', 300),
    gapFillSafety: int(env, 'GAP_FILL_SAFETY', 120),
    resetToHead,
    waitMs: int(env, 'INDEXER_WAIT_MS', 1_000),
  };
}
