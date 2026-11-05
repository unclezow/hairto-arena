import { NeardataClient } from '../src/neardata/client.js';
import { RateLimiter, type Clock } from '../src/neardata/rate-limiter.js';
import { TransactionsApi } from '../src/neardata/tx-api.js';
import { block } from './fixtures.js';

function setup(responses: (url: string, init?: RequestInit) => unknown) {
  let now = 0;
  const clock: Clock = { now: () => now, sleep: async (ms) => void (now += ms) };
  const calls: { url: string; body?: unknown }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const body = responses(url, init);
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const limiter = new RateLimiter(150, clock);
  return { fetch, calls, limiter, clock, advance: (ms: number) => (now += ms) };
}

describe('NeardataClient', () => {
  it('fetches a block and returns null for a missing height, with the API key when set', async () => {
    const s = setup((url) => (url.includes('/v0/block/101') ? block(101) : null));
    const client = new NeardataClient({
      baseUrl: 'https://testnet.neardata.xyz',
      apiKey: 'k1',
      limiter: s.limiter,
      fetch: s.fetch,
      clock: s.clock,
    });
    await expect(client.block(101)).resolves.toMatchObject({ block: { header: { height: 101 } } });
    await expect(client.block(102)).resolves.toBeNull();
    expect(s.calls[0]!.url).toBe('https://testnet.neardata.xyz/v0/block/101?apiKey=k1');
  });

  it('caches the final head for 30 seconds', async () => {
    let head = 150;
    const s = setup(() => block(head));
    const client = new NeardataClient({
      baseUrl: 'https://testnet.neardata.xyz',
      limiter: s.limiter,
      fetch: s.fetch,
      clock: s.clock,
    });
    await expect(client.finalHead()).resolves.toBe(150);
    head = 160;
    s.advance(29_000);
    await expect(client.finalHead()).resolves.toBe(150);
    s.advance(1_000);
    await expect(client.finalHead()).resolves.toBe(160);
    expect(s.calls.map((c) => c.url)).toEqual([
      'https://testnet.neardata.xyz/v0/last_block/final',
      'https://testnet.neardata.xyz/v0/last_block/final',
    ]);
  });

  it('throws on an HTTP error', async () => {
    const s = setup(() => new Response('busy', { status: 429 }));
    const client = new NeardataClient({ baseUrl: 'https://x', limiter: s.limiter, fetch: s.fetch });
    await expect(client.block(1)).rejects.toThrow('HTTP 429');
  });
});

describe('TransactionsApi', () => {
  it('pages through receiver transactions with the resume token', async () => {
    const s = setup((_url, init) => {
      const body = JSON.parse(init!.body as string) as { resume_token?: string };
      return body.resume_token
        ? { account_txs: [{ transaction_hash: 'T3', tx_block_height: 130 }], resume_token: null }
        : {
            account_txs: [
              { transaction_hash: 'T1', tx_block_height: 110 },
              { transaction_hash: 'T2', tx_block_height: 120 },
            ],
            resume_token: 'next',
          };
    });
    const api = new TransactionsApi({
      baseUrl: 'https://tx.test.fastnear.com',
      limiter: s.limiter,
      fetch: s.fetch,
    });
    const txs = await api.receiverTxs('arena.hairto.testnet', 100, 140);
    expect(txs.map((t) => t.transaction_hash)).toEqual(['T1', 'T2', 'T3']);
    expect(s.calls[0]!.body).toMatchObject({
      account_id: 'arena.hairto.testnet',
      is_receiver: true,
      from_tx_block_height: 100,
      to_tx_block_height: 140,
      desc: false,
      limit: 200,
    });
    expect(s.calls[1]!.body).toMatchObject({ resume_token: 'next' });
  });

  it('throws on an HTTP error or an unexpected body', async () => {
    const down = setup(() => new Response('down', { status: 503 }));
    await expect(
      new TransactionsApi({
        baseUrl: 'https://x',
        limiter: down.limiter,
        fetch: down.fetch,
      }).receiverTxs('a', 1, 2),
    ).rejects.toThrow('HTTP 503');
    const odd = setup(() => ({ something: true }));
    await expect(
      new TransactionsApi({
        baseUrl: 'https://x',
        limiter: odd.limiter,
        fetch: odd.fetch,
      }).receiverTxs('a', 1, 2),
    ).rejects.toThrow('unexpected response');
  });
});
