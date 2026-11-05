'use client';

import type { MarketView } from '@hairto-arena/shared';
import { featureReady, featureUnavailable } from '@/lib/features';
export const DEFAULT_BOT_LEVEL = 1;
/** Preserve the existing default carousel selection; no list is searched from user input. */
export function pickDefaultMarket(items: MarketView[]) {
  return items.find((market) => market.open && market.symbol === 'BTC') ?? items.find((market) => market.open) ?? null;
}
/** near-web-duel replaces ticket/start wiring. No signed request is fabricated. */
export function useStartDuel() {
  return { start: async () => { void featureReady('duel'); return featureUnavailable('duel'); } };
}
