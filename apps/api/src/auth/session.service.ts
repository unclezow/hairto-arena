import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { Env } from '../config/env.js';
import { RedisService } from '../redis/redis.service.js';

export type Role = 'user' | 'admin';

export interface Session {
  /** NEAR account id, lowercase. */
  accountId: string;
  role: Role;
  /** Unix seconds of the NEP-413 signature that created the session. */
  signedAt: number;
}

export interface SessionWithToken extends Session {
  token: string;
}

const sessionKey = (token: string) => `session:${createHash('sha256').update(token).digest('hex')}`;

/** Opaque tokens stored hashed in Redis, so a session can be revoked and a leaked Redis dump is useless. */
@Injectable()
export class SessionService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  roleOf(accountId: string): Role {
    const admins = this.config.get('ADMIN_ACCOUNTS', { infer: true });
    return admins.includes(accountId.toLowerCase()) ? 'admin' : 'user';
  }

  async create(accountId: string): Promise<SessionWithToken> {
    const token = randomBytes(32).toString('hex');
    const session: Session = {
      accountId,
      role: this.roleOf(accountId),
      signedAt: Math.floor(Date.now() / 1000),
    };
    await this.redis.client.set(
      sessionKey(token),
      JSON.stringify({ accountId: session.accountId, signedAt: session.signedAt }),
      'EX',
      this.config.get('SESSION_TTL_SEC', { infer: true }),
    );
    return { ...session, token };
  }

  async get(token: string): Promise<SessionWithToken | null> {
    const raw = await this.redis.client.get(sessionKey(token));
    if (!raw) return null;
    const stored = JSON.parse(raw) as { accountId: string; signedAt: number };
    // Role is resolved on every request so an allowlist change applies without re-login.
    return { ...stored, role: this.roleOf(stored.accountId), token };
  }

  /** Best effort lookup for the rate limiter: never throws. */
  async peek(authorization: string | undefined): Promise<Session | null> {
    const token = bearerToken(authorization);
    if (!token) return null;
    return this.get(token).catch(() => null);
  }

  async revoke(token: string): Promise<void> {
    await this.redis.client.del(sessionKey(token));
  }
}

export function bearerToken(authorization: string | undefined): string | null {
  const match = /^Bearer\s+([0-9a-f]{64})$/i.exec(authorization ?? '');
  return match?.[1] ?? null;
}
