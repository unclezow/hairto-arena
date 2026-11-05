import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthCheckService,
  HealthIndicatorService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { upstreamUnavailable } from '../common/errors.js';
import type { Env } from '../config/env.js';
import { NEAR_HEALTH_KEY, type NearHealthReport } from '../near/near-health.service.js';
import { NearService } from '../near/near.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { INDEXER_LAG_KEY } from '../redis/keys.js';
import { RedisService } from '../redis/redis.service.js';

export { INDEXER_LAG_KEY };

const PROBE_TIMEOUT_MS = 2000;

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly near: NearService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Liveness: the process is up. No dependencies. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: Postgres, Redis, RPC reachable and the indexer within the allowed lag. */
  @Get('ready')
  async ready() {
    try {
      return await this.health.check([
        () =>
          this.prismaIndicator.pingCheck('database', this.prisma, { timeout: PROBE_TIMEOUT_MS }),
        () =>
          this.indicators.check('redis').attempt(async () => {
            await withTimeout(this.redis.client.ping());
          }),
        () =>
          this.indicators.check('rpc').attempt(async () => {
            await withTimeout(this.near.near.getStatus());
          }),
        () => this.indexerLag(),
      ]);
    } catch (err) {
      if (err instanceof ServiceUnavailableException) {
        const body = err.getResponse() as { details?: unknown };
        throw upstreamUnavailable('Service not ready', { checks: body.details });
      }
      throw err;
    }
  }

  /**
   * The worker's gas keys: nonce lanes in use and the balance left on each key, as the worker last reported them.
   * `stale` when the report is older than a minute (no worker running, or Redis down).
   */
  @Get('near')
  async nearKeys() {
    const raw = await withTimeout(this.redis.client.get(NEAR_HEALTH_KEY)).catch(() => null);
    const report = raw ? (JSON.parse(raw) as NearHealthReport) : null;
    return {
      network: this.near.deployment.network,
      rpcUrl: this.near.deployment.rpcUrl,
      stale: !report || Date.now() - report.at > 60_000,
      reportedAt: report ? new Date(report.at).toISOString() : null,
      keys: report?.keys ?? {},
    };
  }

  private indexerLag() {
    const indicator = this.indicators.check('indexer');
    return (async () => {
      const raw = await withTimeout(this.redis.client.get(INDEXER_LAG_KEY)).catch(() => null);
      // No value yet means the sync job has not started; do not block readiness on a feature that is off.
      if (raw === null) return indicator.up({ lag: null });
      const lag = Number(raw);
      const max = this.config.get('INDEXER_MAX_LAG_BLOCKS', { infer: true });
      return lag <= max ? indicator.up({ lag }) : indicator.down({ lag, max });
    })();
  }
}

function withTimeout<T>(promise: Promise<T>, ms = PROBE_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref()),
  ]);
}
