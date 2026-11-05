import { PRIZE_CURVE_BPS } from '@hairto-arena/shared';
import { ParamsService } from './params.service.js';

describe('ParamsService', () => {
  it('exposes the shared params and a stable hash', () => {
    const a = new ParamsService();
    const b = new ParamsService();
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(b.hash);
    expect(a.prizeCurveBps).toBe(PRIZE_CURVE_BPS);
    expect(a.vaults.fighter.minDepositUsd).toBe(10);
  });
});
