import { getDeployment } from '@hairto-arena/shared';
import { env } from '../env';

export interface NearConfig {
  network: 'testnet';
  rpcUrl: string;
  explorerUrl: string;
  contracts: { arena: string; vault: string; usdc: string; characters: string };
}

export function fallbackConfig(): NearConfig {
  if (env.network !== 'testnet') throw new Error('This app supports NEAR testnet only.');
  const deployment = getDeployment('testnet');
  return {
    network: 'testnet',
    rpcUrl: deployment.rpcUrl,
    explorerUrl: deployment.explorerUrl,
    contracts: { ...deployment.contracts },
  };
}

export function parseNearConfig(value: unknown): NearConfig {
  if (!value || typeof value !== 'object') throw new Error('Invalid public configuration.');
  const input = value as Partial<NearConfig>;
  if (input.network !== 'testnet') throw new Error('This app supports NEAR testnet only.');
  for (const url of [input.rpcUrl, input.explorerUrl]) {
    if (typeof url !== 'string' || !['https:', 'http:'].includes(new URL(url).protocol)) {
      throw new Error('Invalid public configuration URL.');
    }
  }
  const contracts = input.contracts;
  for (const id of ['arena', 'vault', 'usdc', 'characters'] as const) {
    if (!contracts || typeof contracts[id] !== 'string' || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(contracts[id]) || contracts[id].length < 2 || contracts[id].length > 64) {
      throw new Error('Invalid contract account in public configuration.');
    }
  }
  return { network: 'testnet', rpcUrl: input.rpcUrl!, explorerUrl: input.explorerUrl!, contracts: { ...contracts! } };
}

export async function loadNearConfig(signal: AbortSignal): Promise<NearConfig> {
  let response: Response;
  try {
    response = await fetch(`${env.apiUrl}/api/v1/config`, { signal });
  } catch (error) {
    if (signal.aborted) throw error;
    return fallbackConfig();
  }
  if (!response.ok) throw new Error('Could not load public configuration.');
  return parseNearConfig(await response.json());
}
