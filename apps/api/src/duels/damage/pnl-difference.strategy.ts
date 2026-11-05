import type { DamageDelta, DamageStrategy } from './damage-strategy.js';

export interface PnlDifferenceOptions {
  /** ppm of net PnL per HP point (`DamageConfig::PnlDifference.ppm_per_hp`). */
  ppmPerHp: number;
  /** HP cap of a single hit (`STARTING_HP`). */
  startingHp: number;
  /** Paper cost per trade in ppm (`paper_cost_ppm`). */
  paperCostPpm: number;
  /** Added to the absolute move of an unrevealed position (`UNREVEALED_BASE_PENALTY_PPM`). */
  unrevealedBasePenaltyPpm: number;
}

/**
 * Backend twin of `DamageConfig::PnlDifference` in `contracts/arena/src/damage.rs`. A profit hurts the opponent and
 * a loss hurts yourself on the same scale, so the HP gap follows the net PnL gap until HP is clamped. Integer
 * division truncates toward zero, like Rust.
 */
export class PnlDifferenceStrategy implements DamageStrategy {
  readonly name = 'pnl-difference';

  constructor(private readonly options: PnlDifferenceOptions) {}

  paperCost(): number {
    return this.options.paperCostPpm;
  }

  computeDamage(netPnlPpm: number): DamageDelta {
    if (netPnlPpm > 0) return { selfDelta: 0, opponentDelta: -this.hp(netPnlPpm) };
    if (netPnlPpm < 0) return { selfDelta: -this.hp(-netPnlPpm), opponentDelta: 0 };
    return { selfDelta: 0, opponentDelta: 0 };
  }

  unrevealedPenalty(absMovePpm: number): number {
    return -(Math.abs(absMovePpm) + this.options.unrevealedBasePenaltyPpm);
  }

  private hp(ppm: number) {
    return Math.min(Math.trunc(ppm / this.options.ppmPerHp), this.options.startingHp);
  }
}
