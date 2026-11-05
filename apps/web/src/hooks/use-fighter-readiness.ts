'use client';

import { featureReady } from '@/lib/features';
export type ReadinessStep = 'idle' | 'checking' | 'preparing' | 'ready';
export type ReadinessResult = { ok: true } | { ok: false; reason: 'WRONG_ROLE' | 'NEEDS_DEPOSIT' | 'FAILED'; message: string };
/** near-web-duel owns the live readiness check. */
export function useFighterReadiness() {
  return { step: 'idle' as ReadinessStep, ensureReady: async (): Promise<ReadinessResult> => {
    void featureReady('duel');
    return { ok: false, reason: 'FAILED', message: 'Duels are not available yet.' };
  } };
}
