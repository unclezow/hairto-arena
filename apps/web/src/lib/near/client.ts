import { Near, fromHotConnect } from 'near-kit';
import type { NearConnector } from '@hot-labs/near-connect';
import type { NearConfig } from './config';

export function viewClient(config: NearConfig) {
  return new Near({ network: config.network, rpcUrl: config.rpcUrl });
}

export function walletClient(config: NearConfig, connector: NearConnector) {
  // The SDK outcome enum is wider than near-kit's discriminated outcome union.
  // The adapter forwards the same runtime outcome; no transaction data is transformed here.
  const compatible = connector as unknown as Parameters<typeof fromHotConnect>[0];
  return new Near({ network: config.network, rpcUrl: config.rpcUrl, wallet: fromHotConnect(compatible) });
}
