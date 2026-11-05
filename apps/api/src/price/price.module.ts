import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { ParamsService } from '../config/params.service.js';
import { ActiveAssetsService } from './active-assets.service.js';
import { hyperliquidCoins, MARKETS, parsePriceSources, type PriceSource } from './markets.js';
import type { PriceProvider } from './price-provider.js';
import { RoutedPriceProvider } from './routed.provider.js';
import { HermesProvider } from './hermes.provider.js';
import { HyperliquidProvider } from './hyperliquid.provider.js';
import { NearTickWriter } from './oracle-writer.js';
import { PricePusherService } from './price-pusher.service.js';
import { QuoteService } from './quote.service.js';
import { MockPriceProvider } from './price-provider.js';
import { ORACLE_WRITER, PRICE_PROVIDER } from './price.tokens.js';
import { TickSink } from './tick-sink.js';

/** One provider per source in use. */
function sourceProvider(source: PriceSource, config: ConfigService<Env, true>): PriceProvider {
  if (source === 'hyperliquid') {
    return new HyperliquidProvider({
      apiUrl: config.get('HYPERLIQUID_API_URL', { infer: true }),
      wsUrl: config.get('HYPERLIQUID_WS_URL', { infer: true }),
      pollIntervalMs: config.get('HERMES_POLL_MS', { infer: true }),
      reconnectMs: config.get('HERMES_STREAM_RETRY_MS', { infer: true }),
      coins: hyperliquidCoins(),
    });
  }
  if (source === 'pyth') {
    const apiKey = config.get('PYTH_API_KEY', { infer: true });
    if (!apiKey)
      new Logger('PriceModule').warn('PYTH_API_KEY is not set; Hermes may reject requests');
    return new HermesProvider({
      baseUrl: config.get('PYTH_HERMES_URL', { infer: true }),
      apiKey,
      pollIntervalMs: config.get('HERMES_POLL_MS', { infer: true }),
      streamRetryMs: config.get('HERMES_STREAM_RETRY_MS', { infer: true }),
    });
  }
  return new MockPriceProvider({
    seed: config.get('MOCK_SEED', { infer: true }),
    basePrice: config.get('MOCK_BASE_PRICE', { infer: true }),
    volatilityBps: config.get('MOCK_VOLATILITY_BPS', { infer: true }),
    startMs: Date.now(),
  });
}

/**
 * `PRICE_SOURCE` alone: that one provider. With `PRICE_SOURCES`, a router over each market's sources in order of
 * preference, falling back when the preferred price is older than the staleness limit.
 */
function buildPriceProvider(config: ConfigService<Env, true>, maxAgeMs: number): PriceProvider {
  const fallback = config.get('PRICE_SOURCE', { infer: true });
  const spec = config.get('PRICE_SOURCES', { infer: true });
  if (!spec) return sourceProvider(fallback, config);

  const plan = parsePriceSources(spec, fallback);
  const providers = new Map<PriceSource, PriceProvider>();
  const names = new Map<PriceProvider, string>();
  const routes = new Map<string, PriceProvider[]>();
  for (const market of MARKETS) {
    const chain = plan.get(market.assetId)!.map((source) => {
      if (!providers.has(source)) {
        const provider = sourceProvider(source, config);
        providers.set(source, provider);
        names.set(provider, source);
      }
      return providers.get(source)!;
    });
    routes.set(market.feedId.toLowerCase(), chain);
  }
  new Logger('PriceModule').log(
    `Price sources: ${MARKETS.map((m) => `${m.symbol}=${plan.get(m.assetId)!.join('>')}`).join(', ')}`,
  );
  return new RoutedPriceProvider(routes, maxAgeMs, names);
}

/** Worker side of the price service: provider, display quotes, tick writer, pusher. The read side is PriceStatusModule. */
@Module({
  providers: [
    ActiveAssetsService,
    TickSink,
    NearTickWriter,
    { provide: ORACLE_WRITER, useExisting: NearTickWriter },
    {
      provide: PRICE_PROVIDER,
      inject: [ConfigService, ParamsService],
      useFactory: (config: ConfigService<Env, true>, params: ParamsService) =>
        buildPriceProvider(config, params.oracle.maxStalenessMs),
    },
    QuoteService,
    PricePusherService,
  ],
  exports: [ActiveAssetsService, TickSink],
})
export class PriceModule {}
