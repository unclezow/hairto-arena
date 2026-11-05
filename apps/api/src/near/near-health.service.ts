import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';
import type { LaneStats } from './lane-pool.js';
import { NearService, type SignerRole } from './near.service.js';

/** Worker -> API: lanes and gas-key balances of the worker's keys, for `/health/near`. */
export const NEAR_HEALTH_KEY = 'near:health';
const REPORT_EVERY_MS = 15_000;

export interface GasKeyHealth {
  accountId: string;
  publicKey: string;
  /** yoctoNEAR left on the gas key; null when the key could not be read. */
  balance: string | null;
  /** Nonce lanes the key has on chain, and how many this worker uses. */
  numNonces: number | null;
  lanes: LaneStats;
  error?: string;
}

export interface NearHealthReport {
  at: number;
  network: string;
  keys: Partial<Record<SignerRole, GasKeyHealth>>;
}

/**
 * Runs in the worker, the only process holding gas keys: every few seconds it reads each gas key's balance and
 * nonce lanes from the chain and stores them with the lane usage in Redis, where the API's `/health` finds them.
 */
@Injectable()
export class NearHealthReporter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NearHealthReporter.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly near: NearService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    if (Object.keys(this.near.laneStats()).length === 0) return;
    const run = () =>
      void this.report().catch((e: Error) => this.logger.warn(`NEAR health: ${e.message}`));
    run();
    this.timer = setInterval(run, REPORT_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async report(): Promise<NearHealthReport> {
    const keys: NearHealthReport['keys'] = {};
    for (const [role, lanes] of Object.entries(this.near.laneStats()) as [
      SignerRole,
      LaneStats,
    ][]) {
      const accountId = this.near.accountOf(role);
      const publicKey = this.near.publicKeyOf(role)!;
      try {
        const view = await this.near.near.getAccessKey(accountId, publicKey);
        const permission = view?.permission as
          { GasKeyFunctionCall?: { balance: string; num_nonces: number } } | string | undefined;
        const gasKey = typeof permission === 'object' ? permission.GasKeyFunctionCall : undefined;
        keys[role] = {
          accountId,
          publicKey,
          balance: gasKey?.balance ?? null,
          numNonces: gasKey?.num_nonces ?? null,
          lanes,
          ...(view ? {} : { error: 'key not found on the account' }),
          ...(view && !gasKey ? { error: 'not a gas key' } : {}),
        };
      } catch (err) {
        keys[role] = {
          accountId,
          publicKey,
          balance: null,
          numNonces: null,
          lanes,
          error: (err as Error).message,
        };
      }
    }
    const report: NearHealthReport = {
      at: Date.now(),
      network: this.near.deployment.network,
      keys,
    };
    await this.redis.client.set(NEAR_HEALTH_KEY, JSON.stringify(report), 'EX', 60);
    return report;
  }
}
