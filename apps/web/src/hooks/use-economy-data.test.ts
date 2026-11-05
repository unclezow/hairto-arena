import { describe, expect, it } from 'vitest';
import { toEconomyInputs } from './use-economy-data';

describe('economy inputs', () => {
  it('maps vault views and applies the demo multiplier', () => {
    const inputs = toEconomyInputs(
      {
        apy_bps: 500,
        time_multiplier: 100,
        fighter: { min_deposit: '10000000', fee_bps: 500, owner_share_bps: 0 },
        backer: { min_deposit: '100000000', fee_bps: 1000, owner_share_bps: 5000 },
      },
      { fighter_principal: '20000000', backer_principal: '300000000', pending_fee: '5', pending_pot: '7', pot_held: '0' },
      3,
      42n,
    );
    expect(inputs.tvlA).toBe(20_000_000n);
    expect(inputs.cfgB).toEqual({ minDeposit: 100_000_000n, feeBps: 1000, ownerShareBps: 5000 });
    expect(inputs.rates).toEqual([50_000n, 50_000n]);
    expect(inputs.waiting).toEqual([12n, 0n]);
    expect(inputs.funding).toBe(3n);
    expect(inputs.potNow).toBe(42n);
  });
});
