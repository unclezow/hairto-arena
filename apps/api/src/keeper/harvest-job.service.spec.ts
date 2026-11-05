import type { VaultTotalsView } from '../near/vault.client.js';
import { HarvestJob } from './harvest-job.service.js';
import type { KeeperChain } from './keeper-chain.js';

const USDC = 1_000_000n;

function setup(totals: Partial<VaultTotalsView>, mode: 'live' | 'dry-run' | 'off' = 'live') {
  const calls: string[] = [];
  const chain = {
    vaultTotals: async () => ({
      fighter_principal: '0',
      backer_principal: '0',
      pending_fee: '0',
      pending_pot: '0',
      pot_held: '0',
      payouts_in_flight: 0,
      ...totals,
    }),
    harvest: async () => (calls.push('harvest'), 'TxH'),
    flushPayouts: async () => (calls.push('flush'), 'TxF'),
  } as unknown as KeeperChain;
  const redis = { client: { get: async () => null, set: async () => 'OK' } };
  const config = { get: () => USDC };
  const job = new HarvestJob(
    redis as never,
    config as never,
    { get: async () => mode } as never,
    chain,
  );
  return { job, calls };
}

describe('HarvestJob', () => {
  it('harvests once when 3 USDC of fee and pot are pending, then flushes', async () => {
    const s = setup({ pending_fee: String(USDC), pending_pot: String(2n * USDC) });
    const report = await s.job.runOnce();
    expect(s.calls).toEqual(['harvest', 'flush']);
    expect(report).toMatchObject({ accrued: String(3n * USDC), harvest: 'sent', flush: 'sent' });
  });

  it('sends nothing and says why when only 0.4 USDC is pending', async () => {
    const s = setup({ pending_fee: '100000', pending_pot: '300000' });
    const report = await s.job.runOnce();
    expect(s.calls).toEqual([]);
    expect(report!.harvest).toBe('skipped:yield-too-small (400000 < 1000000)');
  });

  it('still forwards pot the vault holds from an earlier failed payout', async () => {
    const s = setup({ pot_held: '5' });
    await s.job.runOnce();
    expect(s.calls).toEqual(['flush']);
  });

  it('only reports in dry-run mode and does nothing when off', async () => {
    const dry = setup({ pending_pot: String(5n * USDC) }, 'dry-run');
    await expect(dry.job.runOnce()).resolves.toMatchObject({
      harvest: 'dry-run',
      flush: 'dry-run',
    });
    expect(dry.calls).toEqual([]);
    await expect(setup({}, 'off').job.runOnce()).resolves.toBeNull();
  });
});
