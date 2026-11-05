import { describe, expect, it } from 'vitest';
import { hexProofToBase64 } from './season';

describe('proof encoding', () => {
  it('turns hex nodes into base64', () => {
    expect(hexProofToBase64(['00ff', '0xFF00'])).toEqual(['AP8=', '/wA=']);
    expect(hexProofToBase64([])).toEqual([]);
  });
});
