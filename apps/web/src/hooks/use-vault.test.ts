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
