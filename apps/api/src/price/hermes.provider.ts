import { Logger } from '@nestjs/common';
import type { PriceProvider, RawPrice } from './price-provider.js';

export interface HermesOptions {
  baseUrl: string;
  apiKey?: string;
  /** Poll interval while the stream is down. */
  pollIntervalMs: number;
  /** How long to poll before trying to stream again. */
  streamRetryMs: number;
}

interface ParsedFeed {
  id: string;
  price: { price: string; expo: number; publish_time: number };
}

/** Feed ids are compared as lowercase hex without a 0x prefix, the form Hermes answers with. */
const norm = (id: string): string => id.replace(/^0x/i, '').toLowerCase();

/**
 * Prices from Pyth Hermes. Streams over SSE and falls back to polling `latest` when the stream drops, then retries
 * the stream. The latest value per feed is cached; `prices()` never blocks on the network after the first call.
 */
export class HermesProvider implements PriceProvider {
  private readonly logger = new Logger(HermesProvider.name);
  private readonly cache = new Map<string, RawPrice>();
  private watched = '';
  private abort?: AbortController;
  private loop?: Promise<void>;

  constructor(private readonly options: HermesOptions) {}

  async prices(feedIds: string[]): Promise<Map<string, RawPrice>> {
    const ids = [...new Set(feedIds.map(norm))].sort();
    const key = ids.join(',');
    if (key !== this.watched) {
      this.restart(ids);
      this.watched = key;
      // First sight of these feeds: fetch once so the caller has data on its first cycle.
      await this.poll(ids).catch((err: Error) =>
        this.logger.warn(`Hermes poll failed: ${err.message}`),
      );
    }
    const out = new Map<string, RawPrice>();
    for (const id of feedIds) {
      const price = this.cache.get(norm(id));
      if (price) out.set(id, price);
    }
    return out;
  }

  async knownKeys(feedIds: string[]) {
    const known = await listHermesFeedIds(this.options);
    return new Set(feedIds.filter((id) => known.has(norm(id))));
  }

  close() {
    this.abort?.abort();
    this.watched = '';
  }

  private restart(ids: string[]) {
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    this.loop = this.run(ids, abort.signal);
    // The loop only ends when aborted; surface unexpected crashes instead of leaving a dangling rejection.
    this.loop.catch((err: Error) => this.logger.error(`Hermes loop crashed: ${err.message}`));
  }

  private async run(ids: string[], signal: AbortSignal) {
    while (!signal.aborted) {
      try {
        await this.stream(ids, signal);
      } catch (err) {
        if (signal.aborted) return;
        this.logger.warn(`Hermes stream down, polling: ${(err as Error).message}`);
      }
      const retryAt = Date.now() + this.options.streamRetryMs;
      while (!signal.aborted && Date.now() < retryAt) {
        await this.poll(ids).catch((err: Error) =>
          this.logger.warn(`Hermes poll failed: ${err.message}`),
        );
        await sleep(this.options.pollIntervalMs, signal);
      }
    }
  }

  private headers(): Record<string, string> {
    return this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {};
  }

  private query(ids: string[]) {
    return ids.map((id) => `ids[]=${id}`).join('&') + '&parsed=true&encoding=hex';
  }

  private async poll(ids: string[]) {
    if (ids.length === 0) return;
    const res = await fetch(`${this.options.baseUrl}/v2/updates/price/latest?${this.query(ids)}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    this.ingest((await res.json()) as { parsed?: ParsedFeed[] });
  }

  /** Resolves when the stream ends, rejects when it cannot be opened or breaks. */
  private async stream(ids: string[], signal: AbortSignal) {
    if (ids.length === 0) return;
    const res = await fetch(`${this.options.baseUrl}/v2/updates/price/stream?${this.query(ids)}`, {
      headers: { ...this.headers(), accept: 'text/event-stream' },
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let end: number;
      while ((end = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, '');
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('');
        if (!data) continue;
        try {
          this.ingest(JSON.parse(data) as { parsed?: ParsedFeed[] });
        } catch {
          this.logger.warn('Dropped a malformed Hermes event');
        }
      }
    }
  }

  private ingest(payload: { parsed?: ParsedFeed[] }) {
    for (const feed of payload.parsed ?? []) {
      const id = norm(feed.id);
      const next: RawPrice = {
        price: BigInt(feed.price.price),
        expo: feed.price.expo,
        // Hermes publishes in whole seconds.
        publishMs: feed.price.publish_time * 1000,
      };
      const current = this.cache.get(id);
      // Never go back in time when a poll and the stream overlap.
      if (!current || next.publishMs >= current.publishMs) this.cache.set(id, next);
    }
  }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Every feed id Hermes lists (lowercase hex, no prefix). The catalog endpoint works without an API key. */
export async function listHermesFeedIds(options: Pick<HermesOptions, 'baseUrl' | 'apiKey'>) {
  const res = await fetch(`${options.baseUrl}/v2/price_feeds`, {
    headers: options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const feeds = (await res.json()) as { id: string }[];
  return new Set(feeds.map((f) => norm(f.id)));
}
