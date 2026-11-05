'use client';

import { featureReady, featureUnavailable } from '@/lib/features';
/** near-web-duel supplies commit/reveal and calls arenaCall with the quick-play key. */
export function useDuelTrading() {
  void featureReady('duel');
  return { canOpen: false, canClose: false, chooseSide: async () => featureUnavailable('duel'), side: null, openedAt: null, tradesLeft: 0, holdLeft: 0, status: 'Duels are not available yet.', error: null };
}
