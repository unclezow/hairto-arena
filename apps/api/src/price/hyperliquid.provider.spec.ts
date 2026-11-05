import { afterEach, describe, expect, it, vi } from 'vitest';
import { HyperliquidProvider, toRawPrice } from './hyperliquid.provider.js';

describe('toRawPrice', () => {
  it('keeps the decimal exactly at expo -8', () => {
    expect(toRawPrice('333.415', 1)).toEqual({ price: 33_341_500_000n, expo: -8, publishMs: 1 });
    expect(toRawPrice('84255', 1)!.price).toBe(8_425_500_000_000n);
    expect(toRawPrice('0.123456789', 1)!.price).toBe(12_345_678n);
  });

  it('rejects zero and garbage', () => {
    expect(toRawPrice('0', 1)).toBeNull();
    expect(toRawPrice('abc', 1)).toBeNull();
    expect(toRawPrice('-5', 1)).toBeNull();
  });
});

/** Answers `metaAndAssetCtxs` per dex like the real API. */
function fakeInfo(byDex: Record<string, Record<string, string>>) {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { dex?: string };
    bodies.push(body);
    const marks = byDex[body.dex ?? ''] ?? {};
    const names = Object.keys(marks);
    return new Response(
      JSON.stringify([
        { universe: names.map((name) => ({ name })) },
        names.map((n) => ({ markPx: marks[n] })),
      ]),
    );
  });
  return bodies;
}

class SilentSocket {
  static OPEN = 1;
  readyState = 0;
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (e: { data: string }) => void;
  onerror?: () => void;
  sent: string[] = [];
  static last: SilentSocket;
  constructor() {
    SilentSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
}

describe('HyperliquidProvider', () => {
  const coins = {
    btc: 'BTC',
    googl: 'xyz:GOOGL',
    gold: 'xyz:GOLD',
    nope: 'xyz:NOPE',
  };
  const options = {
    coins,
    apiUrl: 'http://hl',
    wsUrl: 'ws://hl',
    pollIntervalMs: 1000,
    reconnectMs: 1000,
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('polls once per dex on first sight, then serves the socket mark price', async () => {
    vi.stubGlobal('WebSocket', SilentSocket);
    const bodies = fakeInfo({
      '': { BTC: '84000.5' },
      xyz: { 'xyz:GOOGL': '333.4', 'xyz:GOLD': '4116.8' },
    });
    const provider = new HyperliquidProvider(options);

    // Callers name markets by feed id; the provider maps them to coins.
    const first = await provider.prices(['btc', 'googl', 'gold']);
    expect(first.get('btc')!.price).toBe(8_400_050_000_000n);
    expect(first.get('gold')!.price).toBe(411_680_000_000n);
    expect(bodies).toEqual([
      { type: 'metaAndAssetCtxs' },
      { type: 'metaAndAssetCtxs', dex: 'xyz' },
    ]);

    const socket = SilentSocket.last;
    socket.readyState = SilentSocket.OPEN;
    socket.onopen?.();
    expect(socket.sent.map((s) => JSON.parse(s).subscription.coin)).toEqual([
      'BTC',
      'xyz:GOOGL',
      'xyz:GOLD',
    ]);
    socket.onmessage?.({
      data: JSON.stringify({
        channel: 'activeAssetCtx',
        data: { coin: 'xyz:GOOGL', ctx: { markPx: '335' } },
      }),
    });
    expect((await provider.prices(['googl'])).get('googl')!.price).toBe(33_500_000_000n);
    expect(bodies).toHaveLength(2);
    provider.close();
  });

  it('reports which markets the venue lists', async () => {
    fakeInfo({ '': { BTC: '1' }, xyz: { 'xyz:GOOGL': '1' } });
    const provider = new HyperliquidProvider(options);
    expect(await provider.knownKeys(['btc', 'googl', 'nope'])).toEqual(new Set(['btc', 'googl']));
  });
});
