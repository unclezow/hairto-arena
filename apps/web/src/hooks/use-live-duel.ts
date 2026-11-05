'use client';

import { DUEL } from '@hairto-arena/shared';
import { featureReady } from '@/lib/features';
/** near-web-duel owns NEAR millisecond event timestamps and the ordered live room. */
export function useLiveDuel() {
  void featureReady('duel');
  return { state: { status: null, fighter: null, winner: null, assetId: null, startMs: null, hp: { fighter: DUEL.startingHp, bot: DUEL.startingHp }, positions: [] }, quotes: [], phase: 'loading' as const, endMs: null, now: Date.now() };
}
