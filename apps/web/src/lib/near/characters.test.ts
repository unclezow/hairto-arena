import { describe, expect, it } from 'vitest';
import { cardState, purchaseRejectionText, type ChainCharacter } from './characters';

const mage: ChainCharacter = { token_id: '1', name: 'Mage', price: '1000000', max_supply: 100, minted: 3, active: true };

describe('store card state', () => {
  it('prefers equipped, then owned', () => {
    expect(cardState(mage, true, true)).toBe('equipped');
    expect(cardState(mage, true, false)).toBe('owned');
  });
  it('shows sold out and unavailable', () => {
    expect(cardState({ ...mage, minted: 100 }, false, false)).toBe('sold_out');
    expect(cardState({ ...mage, active: false }, false, false)).toBe('unavailable');
    expect(cardState(undefined, false, false)).toBe('unavailable');
    expect(cardState({ ...mage, max_supply: 0, minted: 999 }, false, false)).toBe('for_sale');
  });
  it('explains refusals with the refund', () => {
    expect(purchaseRejectionText('underpaid')).toBe('The price changed. Try again. Your USDC was returned.');
  });
});
