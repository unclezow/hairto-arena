import { DAMAGE_SCALE, hpPerBpsOf } from '@hairto-arena/shared';

export type AttackKind = 'basic' | 'medium' | 'ultimate';

/**
 * Attack size from an HP delta, relative to the per-hit cap (400 HP): under a quarter is basic (< 100), under
 * five eighths is medium (< 250), above that ultimate.
 */
export function attackKindFor(damage: number): AttackKind {
  if (damage < DAMAGE_SCALE.maxHitHp / 4) return 'basic';
  if (damage < (DAMAGE_SCALE.maxHitHp * 5) / 8) return 'medium';
  return 'ultimate';
}

/** HP a closed position deals, as AssetScaledDamage computes it: |PnL bps| x the asset's HP-per-bp, capped. */
export const damageForBps = (bps: number, assetId: number) =>
  Math.min(Math.floor(Math.abs(bps) * hpPerBpsOf(assetId)), DAMAGE_SCALE.maxHitHp);
export type FighterSide = 'left' | 'right';
export type CombatStage = 'idle' | 'charging' | 'release' | 'impact';

export type AttackRequest = { id: number; kind: AttackKind; attacker: FighterSide };
export type CombatRuntime = {
  request: AttackRequest | null;
  time: number;
  impacted: boolean;
  released: boolean;
  hitStop: number;
  weapons: Record<
    FighterSide,
    { tip: [number, number, number]; base: [number, number, number] } | null
  >;
};

export const ATTACKS = {
  basic: {
    label: 'Basic',
    name: 'Quickstrike',
    description: 'Close the gap. Strike with steel. Return to your ground.',
    duration: 2.2,
    impact: 0.9,
    animationAt: 0.48,
    release: 0.65,
    damage: 85,
    color: '#ecd09a',
    shortcut: '1',
    tag: 'MELEE / DASH',
  },
  medium: {
    label: 'Medium',
    name: 'Riftbreaker',
    description: 'Channel a crescent of arcane energy and send it across the arena.',
    duration: 3.0,
    impact: 1.45,
    animationAt: 0.18,
    release: 0.72,
    damage: 180,
    color: '#83e5ed',
    shortcut: '2',
    tag: 'ARCANE / PROJECTILE',
  },
  ultimate: {
    label: 'Ultimate',
    name: 'Astral Judgement',
    description: 'Awaken an astral seal. Call down a storm of celestial blades.',
    duration: 4.8,
    impact: 2.55,
    animationAt: 0.04,
    release: 1.45,
    damage: 360,
    color: '#dfb5ff',
    shortcut: '3',
    tag: 'CELESTIAL / FINISHER',
  },
} as const;

export function newCombatRuntime(): CombatRuntime {
  return {
    request: null,
    time: 0,
    impacted: false,
    released: false,
    hitStop: 0,
    weapons: { left: null, right: null },
  };
}
export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
export const smooth = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
export const easeOut = (value: number) => 1 - (1 - clamp01(value)) ** 3;
export const directionFor = (side: FighterSide) => (side === 'left' ? 1 : -1);
export const homeFor = (side: FighterSide) => (side === 'left' ? -3.05 : 3.05);

/** World-space dash. Both the platform and its fighter use this same transform. */
export function dashDistance(kind: AttackKind, time: number) {
  if (kind !== 'basic') return 0;
  if (time < 0.18) return -0.12 * smooth(time / 0.18);
  if (time < 0.7) return -0.12 + 3.32 * easeOut((time - 0.18) / 0.52);
  if (time < 1.13) return 3.2;
  return 3.2 * (1 - smooth((time - 1.13) / 0.82));
}

export function impactEnvelope(time: number, impact: number, duration = 0.5) {
  return time < impact ? 0 : (1 - clamp01((time - impact) / duration)) ** 2;
}

export function attackProgress(runtime: CombatRuntime) {
  return runtime.request ? clamp01(runtime.time / ATTACKS[runtime.request.kind].duration) : 0;
}

/** Shared hero height keeps platforms, fighters and attack effects aligned. */
export const elevationFor = (compact: boolean) => (compact ? 2.8 : 1.9);
export const heroScaleFor = (compact: boolean) => (compact ? 0.72 : 0.62);
