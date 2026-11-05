import { ConfigService } from '@nestjs/config';
import { DAMAGE, DAMAGE_SCALE, DUEL, hpPerBpsOf } from '@hairto-arena/shared';
import type { Env } from '../../config/env.js';
import type { DamageStrategy } from './damage-strategy.js';
import { AssetScaledStrategy } from './asset-scaled.strategy.js';
import { PnlDifferenceStrategy } from './pnl-difference.strategy.js';

export const DAMAGE_STRATEGY = Symbol('DAMAGE_STRATEGY');

/**
 * Picks the damage model by name; a new model means adding a case here and a `DamageConfig` variant in the arena.
 * The numbers come from the shared params (mirroring `contracts/arena/src/params.rs`), never from env, so previews
 * cannot drift from what the arena computes.
 */
export const damageStrategyProvider = {
  provide: DAMAGE_STRATEGY,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): DamageStrategy => {
    switch (config.get('DAMAGE_STRATEGY', { infer: true })) {
      case 'asset-scaled':
        return new AssetScaledStrategy({
          hpPerBps: hpPerBpsOf,
          maxHitHp: DAMAGE_SCALE.maxHitHp,
          paperCostPpm: DAMAGE.paperCostPpm,
          unrevealedBasePenaltyPpm: DAMAGE.unrevealedBasePenaltyPpm,
        });
      case 'pnl-difference':
        return new PnlDifferenceStrategy({
          ppmPerHp: DAMAGE.ppmPerHp,
          startingHp: DUEL.startingHp,
          paperCostPpm: DAMAGE.paperCostPpm,
          unrevealedBasePenaltyPpm: DAMAGE.unrevealedBasePenaltyPpm,
        });
    }
  },
};
