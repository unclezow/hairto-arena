/**
 * Wallet baseline only. Later changes replace these fences before enabling writes.
 * near-web-duel: hooks/use-start-duel.ts, hooks/use-fighter-readiness.ts,
 * hooks/use-duel-onchain.ts, hooks/use-duel-trading.ts, hooks/use-live-duel.ts.
 * The old session-key hooks are removed; use-quick-play-key.ts is the NEAR implementation.
 * components/arena/arena-preview.tsx (live wiring; local scene preview is preserved).
 * components/play/duel-result.tsx (result/replay reads).
 * components/play/play-hub.tsx (battle handler).
 * components/play/character-collection.tsx (store purchase button).
 * near-web-economy: hooks/use-vault.ts, hooks/use-game-assets.ts,
 * hooks/use-lobby-data.ts (equip), components/mvp/{claim-list,backer-panel,economy-panel,admin-panel}.tsx.
 */
export function featureReady(feature: 'duel' | 'economy'): boolean {
  void feature;
  return false;
}
export function featureUnavailable(feature: 'duel' | 'economy'): never {
  throw new Error(`${feature === 'duel' ? 'Duels' : 'Economy actions'} are not available yet.`);
}
