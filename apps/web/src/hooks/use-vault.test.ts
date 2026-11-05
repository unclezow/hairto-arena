import { describe, expect, it } from 'vitest';
import { rejectionText } from './use-vault';

describe('deposit rejection text', () => {
  it('explains the minimum and the refund', () => {
    expect(rejectionText('below_minimum', 'Fighter')).toBe(
      'The Fighter pool needs at least 10 USDC. Your USDC was returned to your wallet.',
    );
    expect(rejectionText('below_minimum', 'Backer')).toContain('100 USDC');
  });
  it('names the other role on a conflict', () => {
    expect(rejectionText('role_conflict', 'Fighter')).toContain('already a Backer');
  });
  it('has a fallback for unknown reasons', () => {
    expect(rejectionText('something', 'Fighter')).toContain('refused the deposit');
  });
});

import { depositCalls } from './use-vault';

describe('deposit transactions', () => {
  const config = { contracts: { vault: 'vault.testnet', usdc: 'usdc.testnet' } };
  it('registers first for a new account, then transfers with the pool', () => {
    const calls = depositCalls(config, false, 10_000_000n, 'Fighter');
    expect(calls.map((c) => `${c.receiverId}:${c.method}`)).toEqual(['vault.testnet:storage_deposit', 'usdc.testnet:ft_transfer_call']);
    expect(calls[0]!.deposit).toBe('10000000000000000000000');
    expect(calls[1]!.args).toEqual({ receiver_id: 'vault.testnet', amount: '10000000', msg: '{"pool":"Fighter"}' });
    expect(calls[1]!.deposit).toBe('1');
  });
  it('skips registration for a registered account', () => {
    expect(depositCalls(config, true, 1n, 'Backer').map((c) => c.method)).toEqual(['ft_transfer_call']);
  });
});
