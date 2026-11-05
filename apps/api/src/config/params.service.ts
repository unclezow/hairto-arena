import { Injectable, Logger } from '@nestjs/common';
import {
  BOT_LEVELS,
  DUEL,
  ORACLE,
  POT_SPLIT,
  PRIZE_CURVE_BPS,
  SCORE,
  SEASON,
  VAULTS,
  toHex,
} from '@hairto-arena/shared';
import { sha256 } from '@noble/hashes/sha2.js';

/** Single read access to the game and economy parameters of `packages/shared`. */
@Injectable()
export class ParamsService {
  private readonly logger = new Logger(ParamsService.name);

  readonly duel = DUEL;
  readonly oracle = ORACLE;
  readonly score = SCORE;
  readonly botLevels = BOT_LEVELS;
  readonly season = SEASON;
  readonly vaults = VAULTS;
  readonly potSplit = POT_SPLIT;
  readonly prizeCurveBps = PRIZE_CURVE_BPS;

  /** Hash of the active parameter set, logged at boot so deployments can be compared. */
  readonly hash = toHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify({
          duel: DUEL,
          oracle: ORACLE,
          score: SCORE,
          botLevels: BOT_LEVELS,
          season: SEASON,
          vaults: VAULTS,
          potSplit: POT_SPLIT,
          prizeCurveBps: PRIZE_CURVE_BPS,
        }),
      ),
    ),
  );

  constructor() {
    this.logger.log(`Active params hash ${this.hash}`);
  }
}
