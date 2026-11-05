import { getDeployment } from '@hairto-arena/shared';

let explorer = getDeployment('testnet').explorerUrl.replace(/\/$/, '');
export function configureExplorer(url: string) { explorer = url.replace(/\/$/, ''); }
export function explorerTx(hash: string) { return `${explorer}/txns/${encodeURIComponent(hash)}`; }
export function explorerAddress(accountId: string) { return `${explorer}/address/${encodeURIComponent(accountId)}`; }
export const shortHash = (hash: string) => hash.length > 18 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
