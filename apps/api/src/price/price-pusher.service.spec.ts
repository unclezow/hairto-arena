import type { ConfigService } from '@nestjs/config';
import type { ParamsService } from '../config/params.service.js';
import type { NearService } from '../near/near.service.js';
import type { RedisService } from '../redis/redis.service.js';
import type { ActiveAsset, ActiveAssetsService } from './active-assets.service.js';
import type { OracleWriter, TickUpdate } from './oracle-writer.js';
import type { RawPrice } from './price-provider.js';
import { PricePusherService } from './price-pusher.service.js';
import type { QuoteService } from './quote.service.js';
import type { TickSink } from './tick-sink.js';

const NOW = 1_800_000_000_000;
const BTC: ActiveAsset = { assetId: 2, feedId: 'e6'.repeat(32) };
const XAU: ActiveAsset = { assetId: 3, feedId: '76'.repeat(32) };

function fakeRedis() {
  const store = new Map<string, string>();
  const published: { channel: string; message: unknown }[] = [];
  const client = {
    eval: vi.fn(async () => 0),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    sadd: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
  };
  const redis = {
    client,
    publish: vi.fn(async (channel: string, message: unknown) => {
      published.push({ channel, message });
    }),
  } as unknown as RedisService;
  return { redis, published, store };
}

function setup(options: { demanded: ActiveAsset[]; hasKey?: boolean; production?: boolean }) {
  const { redis, published } = fakeRedis();
  const env: Record<string, unknown> = {
    PRICE_PUSHER_ENABLED: true,
    PRICE_PUSH_INTERVAL_MS: 1000,
    PRICE_LOCK_TTL_MS: 5000,
    PRICE_SOURCE: 'mock',
    NODE_ENV: options.production ? 'production' : 'test',
  };
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  const near = {
    hasSigner: () => options.hasKey ?? true,
    near: {
      getStatus: async () => ({ sync_info: { latest_block_time: new Date(NOW).toISOString() } }),
    },
  } as unknown as NearService;
  const params = { oracle: { maxStalenessMs: 5_000, voidAfterOutageMs: 10_000 } } as ParamsService;
  const active = {
    resolve: vi.fn(async () => options.demanded),
    runningDuelIds: vi.fn(async () => [7n]),
  } as unknown as ActiveAssetsService;
  const sink = { publish: vi.fn(async () => undefined), flush: vi.fn() } as unknown as TickSink;
  const latest = new Map<number, RawPrice>([
    [2, { price: 9_000_000_000_000n, expo: -8, publishMs: NOW - 1_000 }],
    [3, { price: 400_000_000_000n, expo: -8, publishMs: NOW - 1_000 }],
  ]);
  const quotes = {
    refresh: vi.fn(async () => []),
    latest: (assetId: number) => latest.get(assetId),
  } as unknown as QuoteService;
  const pushes: TickUpdate[][] = [];
  const writer: OracleWriter = {
    push: vi.fn(async (updates: TickUpdate[]) => {
      pushes.push(updates);
      return {
        ticks: updates.map((u, i) => ({
          assetId: u.assetId,
          tickIndex: 100 + i,
          price: u.price,
          expo: u.expo,
          publishMs: u.publishMs,
        })),
        failed: [],
      };
    }),
  };
  const service = new PricePusherService(
    redis,
    near,
    config as never,
    params,
    active,
    sink,
    quotes,
    { prices: async () => new Map() },
    writer,
  );
  return { service, pushes, quotes, published, sink, writer, latest };
}

describe('PricePusherService', () => {
  it('pushes only BTC while only a BTC duel runs, with ms publish times', async () => {
    const s = setup({ demanded: [BTC] });
    s.service.onModuleInit();
    const report = await s.service.runCycle(new Date(NOW));
    expect(report.leader).toBe(true);
    expect(s.pushes).toEqual([
      [
        {
          assetId: 2,
          feedId: BTC.feedId,
          price: 9_000_000_000_000n,
          expo: -8,
          publishMs: NOW - 1_000,
        },
      ],
    ]);
    expect(report.verdicts).toEqual({ 2: 'ok' });
    await s.service.onModuleDestroy();
  });

  it('sends no transaction when nothing is demanded, but still refreshes display quotes', async () => {
    const s = setup({ demanded: [] });
    s.service.onModuleInit();
    const report = await s.service.runCycle(new Date(NOW));
    expect(s.writer.push).not.toHaveBeenCalled();
    expect(s.quotes.refresh).toHaveBeenCalled();
    expect(report.assets).toEqual([]);
    await s.service.onModuleDestroy();
  });

  it('does not push an unchanged quote twice', async () => {
    const s = setup({ demanded: [BTC, XAU] });
    s.service.onModuleInit();
    await s.service.runCycle(new Date(NOW));
    s.latest.set(3, { price: 400_100_000_000n, expo: -8, publishMs: NOW });
    await s.service.runCycle(new Date(NOW + 1_000));
    expect(s.pushes.map((p) => p.map((u) => u.assetId))).toEqual([[2, 3], [3]]);
    await s.service.onModuleDestroy();
  });

  it('marks an asset in outage and signals a void for its running duels', async () => {
    const s = setup({ demanded: [BTC] });
    s.latest.set(2, { price: 1n, expo: -8, publishMs: NOW - 11_000 });
    s.service.onModuleInit();
    const report = await s.service.runCycle(new Date(NOW));
    expect(report.verdicts).toEqual({ 2: 'outage' });
    expect(s.published.map((p) => p.channel)).toEqual(
      expect.arrayContaining(['oracle:status:2', 'price:2', 'oracle:void']),
    );
    await s.service.onModuleDestroy();
  });

  it('only shows display quotes without a pusher key outside production', async () => {
    const s = setup({ demanded: [BTC], hasKey: false });
    s.service.onModuleInit();
    await s.service.runCycle(new Date(NOW));
    expect(s.writer.push).not.toHaveBeenCalled();
    await s.service.onModuleDestroy();
  });

  it('refuses to start in production without a pusher gas key', () => {
    const s = setup({ demanded: [], hasKey: false, production: true });
    expect(() => s.service.onModuleInit()).toThrow('PUSHER_GAS_KEY is required in production');
  });
});
