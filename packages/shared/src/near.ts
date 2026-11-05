import testnet from '../../../deployments/testnet.json' with { type: 'json' };

import type { AccountId, BotLevel } from './types.js';

export type NearNetwork = 'testnet' | 'mainnet';

/**
 * Account ids and public keys of a deployment (`deployments/<network>.json`). Never contains secrets: keys live in
 * the backend environment only.
 */
export interface NearDeployment {
  network: NearNetwork;
  rpcUrl: string;
  /** Block height of the arena deployment, where the indexer starts; null until deployed. */
  startBlock: number | null;
  explorerUrl: string;
  contracts: {
    arena: AccountId;
    vault: AccountId;
    usdc: AccountId;
    characters: AccountId;
  };
  accounts: {
    owner: AccountId;
    operator: AccountId;
    pusher: AccountId;
    keeper: AccountId;
    relayer: AccountId;
    treasury: AccountId;
    bots: Record<`${BotLevel}`, AccountId>;
  };
  /** `ed25519:<base58>` public keys, null until deployed. */
  publicKeys: {
    botService: string | null;
    pusherGasKey: string | null;
    botGasKeys: Record<`${BotLevel}`, string | null>;
  };
}

const DEPLOYMENTS: Partial<Record<NearNetwork, NearDeployment>> = {
  testnet: testnet as NearDeployment,
};

export function getDeployment(network: NearNetwork = 'testnet'): NearDeployment {
  const deployment = DEPLOYMENTS[network];
  if (!deployment) throw new Error(`no deployment manifest for ${network}`);
  return deployment;
}

/** Environment variables that replace a contract id of the manifest. */
export const CONTRACT_ID_ENV = {
  arena: 'ARENA_ID',
  vault: 'VAULT_ID',
  usdc: 'USDC_ID',
  characters: 'CHARACTERS_ID',
} as const;

/** The manifest with contract ids and the RPC URL replaced by any set environment variable. */
export function withOverrides(
  deployment: NearDeployment,
  env: Record<string, string | undefined>,
): NearDeployment {
  const contracts = { ...deployment.contracts };
  for (const [key, name] of Object.entries(CONTRACT_ID_ENV) as [
    keyof NearDeployment['contracts'],
    string,
  ][]) {
    const value = env[name]?.trim();
    if (value) contracts[key] = value;
  }
  return { ...deployment, rpcUrl: env.NEAR_RPC_URL?.trim() || deployment.rpcUrl, contracts };
}

export function explorerTxUrl(deployment: NearDeployment, txHash: string): string {
  return `${deployment.explorerUrl}/txns/${txHash}`;
}

export function explorerAccountUrl(deployment: NearDeployment, accountId: AccountId): string {
  return `${deployment.explorerUrl}/address/${accountId}`;
}
