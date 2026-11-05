import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountDoesNotExistError, parsePublicKey, verifyNep413Signature } from 'near-kit';
import { IMPLICIT_ACCOUNT_PATTERN } from '../common/account-id.js';
import { unauthenticated, upstreamUnavailable } from '../common/errors.js';
import type { Env } from '../config/env.js';
import { NearService } from '../near/near.service.js';
import { RedisService } from '../redis/redis.service.js';
import { SessionService, type SessionWithToken } from './session.service.js';
import { buildSignInMessage, createSignInNonce, parseSignInMessage } from './sign-in-message.js';

const nonceKey = (accountId: string) => `auth:nonce:${accountId}`;

/** A NEP-413 challenge: the wallet signs `message` for `recipient` with `nonce` (base64, 32 bytes). */
export interface SignInChallenge {
  message: string;
  recipient: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}

export interface SignedSignIn {
  accountId: string;
  /** `ed25519:<base58>`. */
  publicKey: string;
  /** Base64 (or base58) ed25519 signature, as the wallet returned it. */
  signature: string;
}

interface StoredChallenge {
  message: string;
  nonce: string;
}

/** NEP-413 sign-in: a single use challenge per account, verified against the account's full-access keys. */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
    private readonly near: NearService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Issues a single use challenge (one per account, a new request replaces the previous one). */
  async createNonce(accountId: string): Promise<SignInChallenge> {
    const ttl = this.config.get('NONCE_TTL_SEC', { infer: true });
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + ttl * 1000);
    const nonce = createSignInNonce(issuedAt.getTime()).toString('base64');
    const recipient = this.config.get('AUTH_DOMAIN', { infer: true });
    const message = buildSignInMessage({
      domain: recipient,
      accountId,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    const stored: StoredChallenge = { message, nonce };
    await this.redis.client.set(nonceKey(accountId), JSON.stringify(stored), 'EX', ttl);
    return {
      message,
      recipient,
      nonce,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async verify(signed: SignedSignIn): Promise<SessionWithToken> {
    const accountId = signed.accountId;
    // GETDEL makes the challenge single use, even under concurrent attempts.
    const raw = await this.redis.client.getdel(nonceKey(accountId));
    if (!raw) throw unauthenticated('Unknown or already used nonce');
    const stored = JSON.parse(raw) as StoredChallenge;

    const fields = parseSignInMessage(stored.message);
    if (!fields || fields.accountId !== accountId)
      throw unauthenticated('Malformed sign-in challenge');
    if (Date.parse(fields.expiresAt) < Date.now()) throw unauthenticated('Sign-in message expired');

    const params = {
      message: stored.message,
      recipient: this.config.get('AUTH_DOMAIN', { infer: true }),
      nonce: Buffer.from(stored.nonce, 'base64'),
    };
    const maxAge = this.config.get('NONCE_TTL_SEC', { infer: true }) * 1000;

    // The signature itself, without any RPC.
    if (!(await verifyNep413Signature(signed, params, { maxAge }))) {
      throw unauthenticated('Invalid signature');
    }

    if (await this.accountExists(accountId)) {
      // The key must be a full-access key of the account: a function-call key cannot sign in.
      if (!(await verifyNep413Signature(signed, params, { maxAge, near: this.near.near }))) {
        throw unauthenticated('The key is not a full-access key of this account');
      }
    } else if (!isOwnImplicitAccount(accountId, signed.publicKey)) {
      // A brand-new implicit account has no keys on chain yet; its id is the key, so nobody else can own it.
      throw unauthenticated('Account does not exist');
    }
    return this.sessions.create(accountId);
  }

  private async accountExists(accountId: string): Promise<boolean> {
    try {
      await this.near.near.rpc.getAccount(accountId);
      return true;
    } catch (err) {
      if (err instanceof AccountDoesNotExistError) return false;
      this.logger.warn(`Account lookup for ${accountId} failed: ${(err as Error).message}`);
      throw upstreamUnavailable('NEAR RPC unavailable');
    }
  }
}

/** True when `accountId` is the implicit id (64 hex) of this ed25519 public key. */
export function isOwnImplicitAccount(accountId: string, publicKey: string): boolean {
  if (!IMPLICIT_ACCOUNT_PATTERN.test(accountId)) return false;
  try {
    const key = parsePublicKey(publicKey);
    if (!publicKey.startsWith('ed25519:')) return false;
    return Buffer.from(key.data).toString('hex') === accountId;
  } catch {
    return false;
  }
}
