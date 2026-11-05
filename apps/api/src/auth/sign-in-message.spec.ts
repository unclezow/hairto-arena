import {
  buildSignInMessage,
  createSignInNonce,
  nonceTimestampMs,
  parseSignInMessage,
} from './sign-in-message.js';

describe('sign-in message', () => {
  const fields = {
    domain: 'hairto.example',
    accountId: 'fighter.testnet',
    issuedAt: '2026-11-04T10:00:00.000Z',
    expiresAt: '2026-11-04T10:10:00.000Z',
  };

  it('round-trips through build and parse', () => {
    const message = buildSignInMessage(fields);
    expect(message).toContain('Account: fighter.testnet');
    expect(parseSignInMessage(message)).toEqual(fields);
  });

  it('rejects anything else', () => {
    expect(parseSignInMessage('sign me')).toBeNull();
    expect(parseSignInMessage(buildSignInMessage(fields) + '\nExtra: 1')).toBeNull();
  });

  it('creates 32-byte nonces that start with the time in milliseconds', () => {
    const a = createSignInNonce(1_800_000_000_123);
    const b = createSignInNonce(1_800_000_000_123);
    expect(a).toHaveLength(32);
    expect(nonceTimestampMs(a)).toBe(1_800_000_000_123);
    expect(a.subarray(8).equals(b.subarray(8))).toBe(false);
  });
});
