/**
 * Feature fences for screens whose chain wiring is not live yet. Duels are live.
 * near-web-economy: hooks/use-vault.ts, hooks/use-game-assets.ts,
 * hooks/use-lobby-data.ts (equip), components/mvp/{claim-list,backer-panel,economy-panel,admin-panel}.tsx.
 * hooks/use-economy-data.ts and components/mvp/wallet-bar.tsx (legacy useTx).
 * components/play/faucet-button.tsx (claim), vault-dialog.tsx (deposit/withdraw),
 * and components/play/character-collection.tsx (store purchase button).
 */
export function featureReady(feature: 'duel' | 'economy'): boolean {
  return feature === 'duel';
}
export function featureUnavailable(feature: 'duel' | 'economy'): never {
  throw new Error(`${feature === 'duel' ? 'Duels' : 'Economy actions'} are not available yet.`);
}
