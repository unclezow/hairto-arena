import { Logger } from '@nestjs/common';
import type { PriceProvider, RawPrice } from './price-provider.js';

/**
 * Several sources per market, in order of preference (`PRICE_SOURCES`). For each market the first source with a
 * price younger than `maxAgeMs` wins; with none fresh, the newest price seen is returned so staleness still shows.
 * This keeps a market open when its preferred source pauses (e.g. Pyth XAU outside gold hours) or stops (an
 * expired key), at the cost of a small jump when the source switches.
 */
export class RoutedPriceProvider implements PriceProvider {
  private readonly logger = new Logger(RoutedPriceProvider.name);
  private readonly active = new Map<string, PriceProvider>();

  constructor(
    /** Feed id (lowercase) -> providers in order of preference. */
    private readonly routes: Map<string, PriceProvider[]>,
    private readonly maxAgeMs: number,
    private readonly names: Map<PriceProvider, string>,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private routeOf(feedId: string) {
    return this.routes.get(feedId.toLowerCase()) ?? [];
  }

  async prices(feedIds: string[]): Promise<Map<string, RawPrice>> {
    const byProvider = new Map<PriceProvider, string[]>();
    for (const id of feedIds)
      for (const p of this.routeOf(id)) byProvider.set(p, [...(byProvider.get(p) ?? []), id]);

    const results = new Map<PriceProvider, Map<string, RawPrice>>();
    await Promise.all(
      [...byProvider].map(async ([provider, ids]) => {
        try {
          results.set(provider, await provider.prices(ids));
        } catch (err) {
          this.logger.warn(`${this.names.get(provider)} failed: ${(err as Error).message}`);
          results.set(provider, new Map());
        }
      }),
    );

    const out = new Map<string, RawPrice>();
    const now = this.now();
    for (const id of feedIds) {
      const candidates = this.routeOf(id).flatMap((p) => {
        const price = results.get(p)?.get(id);
        return price ? [{ p, price }] : [];
      });
      const chosen =
        candidates.find((c) => now - c.price.publishMs <= this.maxAgeMs) ??
        candidates.sort((a, b) => b.price.publishMs - a.price.publishMs)[0];
      if (!chosen) continue;
      if (this.active.get(id) !== chosen.p) {
        this.logger.log(`${id.slice(0, 10)}… now priced by ${this.names.get(chosen.p)}`);
        this.active.set(id, chosen.p);
      }
      out.set(id, chosen.price);
    }
    return out;
  }

  /** A market is known when any of its sources lists it. */
  async knownKeys(feedIds: string[]) {
    const known = new Set<string>();
    for (const provider of new Set([...this.routes.values()].flat())) {
      const ids = feedIds.filter((id) => this.routeOf(id).includes(provider));
      if (ids.length === 0) continue;
      try {
        const listed = provider.knownKeys ? await provider.knownKeys(ids) : new Set(ids);
        for (const id of listed) known.add(id);
      } catch (err) {
        this.logger.warn(`${this.names.get(provider)} check failed: ${(err as Error).message}`);
      }
    }
    return known;
  }

  close() {
    for (const provider of new Set([...this.routes.values()].flat())) provider.close?.();
  }
}
