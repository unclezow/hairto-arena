import type { Clock } from './rate-limiter.js';
import { RateLimiter, realClock } from './rate-limiter.js';
import type { NeardataBlock } from './types.js';

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface NeardataOptions {
  /** `https://testnet.neardata.xyz` */
  baseUrl: string;
  apiKey?: string;
  limiter: RateLimiter;
  fetch?: Fetch;
  clock?: Clock;
  /** How long the final head is reused before asking again (default 30 s). */
  headTtlMs?: number;
}

export class NeardataError extends Error {}

/**
 * Final blocks from FastNEAR Neardata. `block(h)` is null when the height does not exist (a skipped height, or
 * one not produced yet); `finalHead()` follows the `/v0/last_block/final` redirect and is cached.
 */
export class NeardataClient {
  private readonly fetch: Fetch;
  private readonly clock: Clock;
  private head: { height: number; at: number } | null = null;

  constructor(private readonly options: NeardataOptions) {
    this.fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.clock = options.clock ?? realClock;
  }

  private url(path: string) {
    const url = new URL(path, this.options.baseUrl);
    if (this.options.apiKey) url.searchParams.set('apiKey', this.options.apiKey);
    return url.toString();
  }

  private async get(path: string): Promise<unknown> {
    await this.options.limiter.take();
    const res = await this.fetch(this.url(path), { redirect: 'follow' });
    if (!res.ok) throw new NeardataError(`Neardata ${path}: HTTP ${res.status}`);
    return res.json();
  }

  async block(height: number): Promise<NeardataBlock | null> {
    const body = (await this.get(`/v0/block/${height}`)) as NeardataBlock | null;
    if (body !== null) this.noteHead(body.block.header.height);
    return body;
  }

  /** Height of the newest final block, at most `headTtlMs` old. */
  async finalHead(): Promise<number> {
    const ttl = this.options.headTtlMs ?? 30_000;
    if (this.head && this.clock.now() - this.head.at < ttl) return this.head.height;
    const body = (await this.get('/v0/last_block/final')) as NeardataBlock | null;
    if (!body) throw new NeardataError('Neardata returned no final block');
    this.head = { height: body.block.header.height, at: this.clock.now() };
    return this.head.height;
  }

  /** A block we just fetched is final by definition, so it can only move the cached head forward. */
  private noteHead(height: number) {
    if (this.head && height > this.head.height) this.head = { height, at: this.head.at };
  }
}
