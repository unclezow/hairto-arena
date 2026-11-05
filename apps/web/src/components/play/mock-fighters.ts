'use client';

import { useSyncExternalStore } from 'react';

/** Temporary owned collection until account inventory is connected. */
export const OWNED_FIGHTERS = [
  { id: 0, kind: 'Knight', title: 'The Sentinel', motto: 'STEEL & RESOLVE', weapon: '1H_Sword' },
  { id: 1, kind: 'Mage', title: 'The Arcanist', motto: 'SPARK & SORCERY', weapon: '2H_Staff' },
  { id: 2, kind: 'Rogue', title: 'The Shadowblade', motto: 'SWIFT & SILENT', weapon: 'Knife' },
] as const;

export type OwnedFighter = (typeof OWNED_FIGHTERS)[number];
const STORAGE_KEY = 'duelvault:mock-equipped-character';
const CHANGE_EVENT = 'duelvault:character-change';

function readSelected() {
  try {
    const id = Number(localStorage.getItem(STORAGE_KEY));
    return OWNED_FIGHTERS.find((fighter) => fighter.id === id)?.id ?? 0;
  } catch {
    return 0;
  }
}
function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

export function useSelectedFighter() {
  const id = useSyncExternalStore(subscribe, readSelected, () => 0);
  return OWNED_FIGHTERS.find((fighter) => fighter.id === id) ?? OWNED_FIGHTERS[0];
}

export function selectMockFighter(id: number) {
  if (!OWNED_FIGHTERS.some((fighter) => fighter.id === id)) return;
  try {
    localStorage.setItem(STORAGE_KEY, String(id));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function hiddenAccessories(kind: string): string[] {
  if (kind === 'Mage') return ['Spellbook', 'Spellbook_open', '1H_Wand'];
  if (kind.startsWith('Rogue')) return ['1H_Crossbow', '2H_Crossbow', 'Throwable'];
  if (kind === 'Barbarian') return ['1H_Axe_Offhand', '2H_Axe', 'Mug'];
  return ['1H_Sword_Offhand', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '2H_Sword'];
}
