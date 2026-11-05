import { Logger } from '@nestjs/common';
import type { PriceProvider, RawPrice } from './price-provider.js';

export interface HyperliquidOptions {
  /** REST base, e.g. https://api.hyperliquid.xyz */
  apiUrl: string;
  /** WebSocket, e.g. wss://api.hyperliquid.xyz/ws */
  wsUrl: string;
  /** Poll interval while the socket is down. */
  pollIntervalMs: number;
  /** Wait before reconnecting the socket. */
  reconnectMs: number;
  /** Market feed id -> Hyperliquid coin. Callers name markets by feed id, like every other source. */
  coins: Record<string, string>;
}

/** Prices travel as decimal strings; keep them as an integer mantissa at a fixed exponent. */
export const HYPERLIQUID_EXPO = -8;

export function toRawPrice(decimal: string, publishMs: number): RawPrice | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
  if (!match) return null;
  const digits = -HYPERLIQUID_EXPO;
  const fraction = (match[2] ?? '').slice(0, digits).padEnd(digits, '0');
  const price = BigInt(match[1]! + fraction);
  return price > 0n ? { price, expo: HYPERLIQUID_EXPO, publishMs } : null;
}

/** HIP-3 markets are named `<dex>:<coin>`; the main perp dex has no prefix. */
const dexOf = (coin: string) => (coin.includes(':') ? coin.split(':')[0]! : '');

interface AssetCtxMessage {
  channel: string;
  data?: { coin?: string; ctx?: { markPx?: string } };
}

/**
 * Prices from Hyperliquid's public API (no key): the mark price of each market (`activeAssetCtx`, pushed about
 * once a second), which Hyperliquid itself uses for margining. The socket carries no timestamp, so the publish
 * time is when the update arrived, in ms. While the socket is down, `metaAndAssetCtxs` is polled.
 */
export class HyperliquidProvider implements PriceProvider {
  private readonly logger = new Logger(HyperliquidProvider.name);
  private readonly cache = new Map<string, RawPrice>();
  private watched = new Set<string>();
  private socket?: WebSocket;
  private closed = false;
  private pollTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(private readonly options: HyperliquidOptions) {}

  private coinOf(feedId: string) {
    return this.options.coins[feedId.toLowerCase()];
  }

  async prices(feedIds: string[]): Promise<Map<string, RawPrice>> {
    const coins = feedIds.flatMap((id) => this.coinOf(id) ?? []);
    const fresh = coins.filter((c) => !this.watched.has(c));
    if (fresh.length > 0) {
      for (const coin of fresh) this.watched.add(coin);
      this.ensureSocket();
      for (const coin of fresh) this.subscribe(coin);
      // First sight of these markets: one poll so the caller has data on its first cycle.
      await this.poll().catch((err: Error) =>
        this.logger.warn(`Hyperliquid poll failed: ${err.message}`),
      );
    }
    const out = new Map<string, RawPrice>();
    for (const feedId of feedIds) {
      const coin = this.coinOf(feedId);
      const price = coin ? this.cache.get(coin) : undefined;
      if (price) out.set(feedId, price);
    }
    return out;
  }

  async knownKeys(feedIds: string[]) {
    const coins = feedIds.flatMap((id) => this.coinOf(id) ?? []);
    const known = new Set<string>();
    for (const dex of new Set(coins.map(dexOf))) {
      const [meta] = await this.info<[{ universe: { name: string }[] }, unknown[]]>({
        type: 'metaAndAssetCtxs',
        ...(dex ? { dex } : {}),
      });
      for (const asset of meta.universe) known.add(asset.name);
    }
    return new Set(feedIds.filter((id) => known.has(this.coinOf(id) ?? '')));
  }

  close() {
    this.closed = true;
    clearInterval(this.pollTimer);
    clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }

  private ensureSocket() {
    if (this.socket || this.closed) return;
    const socket = new WebSocket(this.options.wsUrl);
    this.socket = socket;
    socket.onopen = () => {
      this.stopPolling();
      for (const coin of this.watched) this.subscribe(coin);
    };
    socket.onmessage = (event) => {
      try {
        this.ingest(JSON.parse(String(event.data)) as AssetCtxMessage);
      } catch {
        this.logger.warn('Dropped a malformed Hyperliquid message');
      }
    };
    socket.onclose = () => {
      this.socket = undefined;
      if (this.closed) return;
      this.logger.warn('Hyperliquid socket closed, polling until it reconnects');
      this.startPolling();
      this.reconnectTimer = setTimeout(() => this.ensureSocket(), this.options.reconnectMs);
    };
    socket.onerror = () => socket.close();
  }

  private subscribe(coin: string) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(
      JSON.stringify({ method: 'subscribe', subscription: { type: 'activeAssetCtx', coin } }),
    );
  }

  private ingest(message: AssetCtxMessage) {
    if (message.channel !== 'activeAssetCtx') return;
    const coin = message.data?.coin;
    const mark = message.data?.ctx?.markPx;
    if (!coin || !mark || !this.watched.has(coin)) return;
    this.store(coin, mark);
  }

  private store(coin: string, mark: string) {
    const next = toRawPrice(mark, Date.now());
    if (!next) return;
    const current = this.cache.get(coin);
    if (!current || next.publishMs >= current.publishMs) this.cache.set(coin, next);
  }

  private startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(
      () =>
        void this.poll().catch((err: Error) =>
          this.logger.warn(`Hyperliquid poll failed: ${err.message}`),
        ),
      this.options.pollIntervalMs,
    );
    this.pollTimer.unref();
  }

  private stopPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  /** One `metaAndAssetCtxs` request per dex in use. */
  private async poll() {
    for (const dex of new Set([...this.watched].map(dexOf))) {
      const [meta, ctxs] = await this.info<
        [{ universe: { name: string }[] }, { markPx?: string }[]]
      >({
        type: 'metaAndAssetCtxs',
        ...(dex ? { dex } : {}),
      });
      meta.universe.forEach((asset, i) => {
        const mark = ctxs[i]?.markPx;
        if (mark && this.watched.has(asset.name)) this.store(asset.name, mark);
      });
    }
  }

  private async info<T>(body: object): Promise<T> {
    const res = await fetch(`${this.options.apiUrl}/info`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}
