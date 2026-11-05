import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HermesProvider } from './hermes.provider.js';

const FEED = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);

const parsed = (id: string, price: number, publishTime: number) => ({
  id,
  price: { price: String(price), conf: '1', expo: -8, publish_time: publishTime },
});

/** A tiny Hermes: `latest` answers from `prices`, `stream` keeps the connection open until told otherwise. */
class FakeHermes {
  server!: Server;
  url = '';
  prices = new Map<string, { price: number; publishTime: number }>();
  streams: ServerResponse[] = [];
  requests: { path: string; auth?: string; ids: string[] }[] = [];
  streamAvailable = true;

  async start() {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop() {
    for (const s of this.streams) s.destroy();
    this.server.closeAllConnections();
    await new Promise((resolve) => this.server.close(resolve));
  }

  body(ids: string[]) {
    return {
      parsed: ids
        .filter((id) => this.prices.has(id))
        .map((id) => parsed(id, this.prices.get(id)!.price, this.prices.get(id)!.publishTime)),
    };
  }

  /** Sends one SSE event to every open stream. */
  push(ids: string[]) {
    for (const s of this.streams) s.write(`data: ${JSON.stringify(this.body(ids))}\n\n`);
  }

  dropStreams() {
    for (const s of this.streams) s.destroy();
    this.streams = [];
  }

  private handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url!, this.url);
    const ids = url.searchParams.getAll('ids[]');
    this.requests.push({ path: url.pathname, auth: req.headers.authorization, ids });

    if (url.pathname === '/v2/updates/price/latest') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(this.body(ids)));
    } else if (url.pathname === '/v2/updates/price/stream' && this.streamAvailable) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      this.streams.push(res);
      res.write(`data: ${JSON.stringify(this.body(ids))}\n\n`);
    } else {
      res.writeHead(503).end();
    }
  }
}

const until = async (check: () => boolean, ms = 3000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('HermesProvider', () => {
  let hermes: FakeHermes;
  let provider: HermesProvider;

  beforeEach(async () => {
    hermes = new FakeHermes();
    await hermes.start();
    hermes.prices.set(FEED, { price: 12_300_000_000, publishTime: 1000 });
    provider = new HermesProvider({
      baseUrl: hermes.url,
      apiKey: 'secret-key',
      pollIntervalMs: 20,
      streamRetryMs: 150,
    });
  });

  afterEach(async () => {
    provider.close();
    await hermes.stop();
  });

  it('returns the price of a feed on the first call and sends the API key', async () => {
    const prices = await provider.prices([FEED]);
    expect(prices.get(FEED)).toEqual({ price: 12_300_000_000n, expo: -8, publishMs: 1_000_000 });
    expect(hermes.requests.every((r) => r.auth === 'Bearer secret-key')).toBe(true);
    expect(hermes.requests[0]!.ids).toEqual([FEED]);
  });

  it('follows the stream for newer prices', async () => {
    await provider.prices([FEED]);
    await until(() => hermes.streams.length === 1);

    hermes.prices.set(FEED, { price: 12_400_000_000, publishTime: 1001 });
    hermes.push([FEED]);
    await until(() => hermes.requests.length > 0);
    await new Promise((r) => setTimeout(r, 50));

    expect((await provider.prices([FEED])).get(FEED)!.price).toBe(12_400_000_000n);
  });

  it('falls back to polling when the stream drops and streams again later', async () => {
    await provider.prices([FEED]);
    await until(() => hermes.streams.length === 1);

    hermes.streamAvailable = false;
    hermes.dropStreams();
    hermes.prices.set(FEED, { price: 12_500_000_000, publishTime: 1002 });
    await until(() => hermes.requests.filter((r) => r.path.endsWith('/latest')).length >= 3);
    expect((await provider.prices([FEED])).get(FEED)!.price).toBe(12_500_000_000n);

    hermes.streamAvailable = true;
    await until(() => hermes.streams.length === 1);
  });

  it('never replaces a newer price with an older one', async () => {
    await provider.prices([FEED]);
    await until(() => hermes.streams.length === 1);

    hermes.prices.set(FEED, { price: 1, publishTime: 999 });
    hermes.push([FEED]);
    await new Promise((r) => setTimeout(r, 50));

    expect((await provider.prices([FEED])).get(FEED)!.publishMs).toBe(1_000_000);
  });

  it('resubscribes when the set of feeds changes', async () => {
    hermes.prices.set(OTHER, { price: 5, publishTime: 1000 });
    await provider.prices([FEED]);
    const both = await provider.prices([FEED, OTHER]);
    expect([...both.keys()].sort()).toEqual([FEED, OTHER].sort());
  });

  it('omits a feed Hermes does not know instead of failing', async () => {
    const prices = await provider.prices([FEED, OTHER]);
    expect(prices.has(OTHER)).toBe(false);
    expect(prices.has(FEED)).toBe(true);
  });

  it('returns an empty map, not an error, when Hermes is unreachable', async () => {
    await hermes.stop();
    const prices = await provider.prices([FEED]);
    expect(prices.size).toBe(0);
    hermes = new FakeHermes();
    await hermes.start();
  });
});
