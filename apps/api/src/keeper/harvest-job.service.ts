import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { RedisService } from '../redis/redis.service.js';
import { KeeperModeService } from './keeper-mode.js';
import { KEEPER_CHAIN, type KeeperChain } from './keeper-chain.js';

export type HarvestOutcome = 'sent' | 'dry-run' | `skipped:${string}` | `failed:${string}`;

export interface HarvestReport {
  at: string;
  /** Fee and pot the vault had accrued up to now (`get_totals`), in USDC base units. */
  accrued: string;
  harvest: HarvestOutcome;
  /** Sent after a harvest, or on its own while the vault still holds pot to forward. */
  flush: HarvestOutcome;
}

/** Another process can set this key to say the vault's yield must not be split right now. */
export const VALUATION_STALE_KEY = 'keeper:valuation-stale';
/** The last report, for the admin status page. */
export const LAST_HARVEST_KEY = 'keeper:harvest:last';
/** Pub/sub: the API asks the worker for a harvest cycle now (`POST /admin/keeper/harvest`). */
export const HARVEST_NOW_CHANNEL = 'keeper:harvest-now';

/**
 * One harvest cycle: read the vault's accrued fee and pot (`get_totals`), skip below `KEEPER_MIN_HARVEST_UNITS`,
 * otherwise call `vault.harvest`, then `vault.flush_payouts` while anything is still held. Both are awaited and
 * logged. Harvest never touches principal, and a failed or skipped harvest cannot block a withdrawal.
 */
@Injectable()
export class HarvestJob {
  private readonly logger = new Logger(HarvestJob.name);

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService<Env, true>,
    private readonly mode: KeeperModeService,
    @Inject(KEEPER_CHAIN) private readonly chain: KeeperChain,
  ) {}

  async runOnce(now = new Date()): Promise<HarvestReport | null> {
    const mode = await this.mode.get();
    if (mode === 'off') return null;

    const totals = await this.chain.vaultTotals();
    const accrued = BigInt(totals.pending_fee) + BigInt(totals.pending_pot);
    const held = BigInt(totals.pot_held) > 0n;
    const report: HarvestReport = {
      at: now.toISOString(),
      accrued: accrued.toString(),
      harvest: 'skipped:not-run',
      flush: 'skipped:nothing-held',
    };

    const minimum = this.config.get('KEEPER_MIN_HARVEST_UNITS', { infer: true });
    if ((await this.redis.client.get(VALUATION_STALE_KEY)) !== null) {
      report.harvest = 'skipped:valuation-stale';
    } else if (accrued < minimum) {
      report.harvest = `skipped:yield-too-small (${accrued} < ${minimum})`;
    } else {
      report.harvest = await this.send(mode, 'harvest', () => this.chain.harvest());
    }

    if (report.harvest === 'sent' || report.harvest === 'dry-run' || held) {
      report.flush = await this.send(mode, 'flush_payouts', () => this.chain.flushPayouts());
    }
    this.logger.log(
      `Harvest cycle: accrued ${accrued}, harvest ${report.harvest}, flush ${report.flush}`,
    );
    await this.redis.client
      .set(LAST_HARVEST_KEY, JSON.stringify(report), 'EX', 7 * 86_400)
      .catch(() => undefined);
    return report;
  }

  private async send(
    mode: 'live' | 'dry-run',
    name: string,
    call: () => Promise<string>,
  ): Promise<HarvestOutcome> {
    if (mode === 'dry-run') return 'dry-run';
    try {
      const tx = await call();
      this.logger.log(`vault.${name} sent: ${tx}`);
      return 'sent';
    } catch (err) {
      // Logged and retried on the next cycle. Principal and withdrawals are untouched.
      this.logger.warn(`vault.${name} failed: ${(err as Error).message}`);
      return `failed:${(err as Error).message.slice(0, 120)}`;
    }
  }
}
