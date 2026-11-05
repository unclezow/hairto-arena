import { randomBytes } from 'node:crypto';

export interface SignInFields {
  /** App id: the NEP-413 recipient, also named in the message. */
  domain: string;
  accountId: string;
  issuedAt: string;
  expiresAt: string;
}

/** Text the wallet signs with NEP-413 `signMessage`. The server builds it; the wallet only signs it. */
export function buildSignInMessage(f: SignInFields): string {
  return [
    `${f.domain} wants you to sign in with your NEAR account.`,
    '',
    `Account: ${f.accountId}`,
    `Issued At: ${f.issuedAt}`,
    `Expires At: ${f.expiresAt}`,
  ].join('\n');
}

export function parseSignInMessage(message: string): SignInFields | null {
  const m =
    /^(.+) wants you to sign in with your NEAR account\.\n\nAccount: (\S+)\nIssued At: (\S+)\nExpires At: (\S+)$/.exec(
      message,
    );
  if (!m) return null;
  return { domain: m[1]!, accountId: m[2]!, issuedAt: m[3]!, expiresAt: m[4]! };
}

/**
 * NEP-413 nonce: 32 bytes, an 8-byte big-endian millisecond timestamp followed by 24 random bytes. The timestamp
 * lets the verifier reject old signatures without state; single use is enforced in Redis.
 */
export function createSignInNonce(nowMs = Date.now()): Buffer {
  const nonce = Buffer.alloc(32);
  nonce.writeBigUInt64BE(BigInt(nowMs), 0);
  randomBytes(24).copy(nonce, 8);
  return nonce;
}

export function nonceTimestampMs(nonce: Uint8Array): number {
  return Number(Buffer.from(nonce).readBigUInt64BE(0));
}
