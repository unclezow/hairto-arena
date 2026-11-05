import { describe, expect, it } from 'vitest';
import { explorerAccountUrl, explorerTxUrl, getDeployment, withOverrides } from './near.js';

describe('deployment manifest', () => {
  it('loads testnet account ids', () => {
    const d = getDeployment();
    expect(d.network).toBe('testnet');
    expect(d.contracts.arena).toBe('arena.hairto.testnet');
    expect(d.accounts.bots['4']).toBe('oracle.bots.hairto.testnet');
  });

  it('holds no secrets', () => {
    const text = JSON.stringify(getDeployment());
    expect(text).not.toMatch(/ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/);
    expect(text.toLowerCase()).not.toContain('private');
    expect(text.toLowerCase()).not.toContain('secret');
  });

  it('lets env override a contract id', () => {
    const d = withOverrides(getDeployment(), { ARENA_ID: 'arena2.hairto.testnet', VAULT_ID: ' ' });
    expect(d.contracts.arena).toBe('arena2.hairto.testnet');
    expect(d.contracts.vault).toBe('vault.hairto.testnet');
    expect(getDeployment().contracts.arena).toBe('arena.hairto.testnet');
    expect(withOverrides(getDeployment(), { NEAR_RPC_URL: 'http://localhost:3030' }).rpcUrl).toBe(
      'http://localhost:3030',
    );
  });

  it('builds explorer links', () => {
    const d = getDeployment();
    expect(explorerTxUrl(d, 'abc')).toBe('https://testnet.nearblocks.io/txns/abc');
    expect(explorerAccountUrl(d, 'fighter.testnet')).toBe(
      'https://testnet.nearblocks.io/address/fighter.testnet',
    );
  });
});
