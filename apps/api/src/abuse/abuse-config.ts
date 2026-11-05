import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { ParamsService } from '../config/params.service.js';
import { toUnits } from '../read-model/wallet-status.service.js';
import type { AbuseThresholds } from './rules.js';

/** The thresholds come from configuration, not from code, so they can change without a release. */
@Injectable()
export class AbuseConfig {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly params: ParamsService,
  ) {}

  get reportOnly() {
    return this.config.get('ABUSE_REPORT_ONLY', { infer: true });
  }

  get thresholds(): AbuseThresholds {
    const get = <K extends keyof Env>(k: K) => this.config.get(k, { infer: true }) as Env[K];
    return {
      minDuels: get('ABUSE_MIN_DUELS'),
      lv1Share: get('ABUSE_LV1_SHARE'),
      lv1WinRate: get('ABUSE_LV1_WINRATE'),
      maxCountedPerDay: this.params.score.maxCountedDuelsPerDay,
      capDays: get('ABUSE_CAP_DAYS'),
      intervalCv: get('ABUSE_INTERVAL_CV'),
      baselineWinRate: get('ABUSE_BASELINE_WINRATE'),
      winRateZ: get('ABUSE_WINRATE_Z'),
      cycleCount: get('ABUSE_CYCLE_COUNT'),
      cycleWindowSec: get('ABUSE_CYCLE_WINDOW_SEC'),
      minDeposit: toUnits(this.params.vaults.fighter.minDepositUsd),
    };
  }
}
