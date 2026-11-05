import type { DamageDelta, DamageStrategy } from './damage-strategy.js';

export interface AssetScaledOptions {
  /** HP per bp of net PnL, by asset id (`DamageConfig::AssetScaled.hp_per_bps`). */
  hpPerBps: (assetId: number) => number;
  /** Largest HP change of one closed position (`max_hit_hp`). */
  maxHitHp: number;
  paperCostPpm: number;
  /** Added to the absolute move of an unrevealed position (`UNREVEALED_BASE_PENALTY_PPM`). */
  unrevealedBasePenaltyPpm: number;
}

const PPM_PER_BPS = 100;

/**
 * Backend twin of `DamageConfig::AssetScaled` in `contracts/arena/src/damage.rs`: HP = |net PnL bps| x the asset's
 * HP-per-bp, capped per hit; profit hurts the opponent, loss hurts the owner. Integer division truncates toward
 * zero, like Rust.
 */
export class AssetScaledStrategy implements DamageStrategy {
  readonly name = 'asset-scaled';

  constructor(private readonly options: AssetScaledOptions) {}

  paperCost(): number {
    return this.options.paperCostPpm;
  }

  computeDamage(netPnlPpm: number, assetId: number): DamageDelta {
    if (netPnlPpm > 0) return { selfDelta: 0, opponentDelta: -this.hp(netPnlPpm, assetId) };
    if (netPnlPpm < 0) return { selfDelta: -this.hp(-netPnlPpm, assetId), opponentDelta: 0 };
    return { selfDelta: 0, opponentDelta: 0 };
  }

  unrevealedPenalty(absMovePpm: number): number {
    return -(Math.abs(absMovePpm) + this.options.unrevealedBasePenaltyPpm);
  }

  private hp(ppm: number, assetId: number) {
    const hp = Math.trunc((ppm * this.options.hpPerBps(assetId)) / PPM_PER_BPS);
    return Math.min(hp, this.options.maxHitHp);
  }
}
