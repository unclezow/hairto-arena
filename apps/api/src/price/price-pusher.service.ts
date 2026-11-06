import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WS_EVENTS,
  type OracleHealth,
  type OracleHealthEvent,
  type QuoteEvent,
} from '@hairto-arena/shared';
import { randomUUID } from 'node:crypto';
import { ParamsService } from '../config/params.service.js';
import type { Env } from '../config/env.js';
import { NearService } from '../near/near.service.js';
import { CHANNELS } from '../realtime/channels.js';
import { RedisService } from '../redis/redis.service.js';
import { ActiveAssetsService, type ActiveAsset } from './active-assets.service.js';
import { ORACLE_KEYS, type OracleState } from './oracle-keys.js';
import { oracleVerdict } from './oracle-health.js';
import { ORACLE_WRITER, PRICE_PROVIDER } from './price.tokens.js';
import type { OracleWriter, PushResult, RecordedTick, TickUpdate } from './oracle-writer.js';
import type { PriceProvider } from './price-provider.js';
import { QuoteService } from './quote.service.js';
import { TickSink } from './tick-sink.js';

export interface CycleReport {
  /** False when another instance holds the pusher lock. */
  leader: boolean;
  /** Display quotes published this cycle, for every market. */
  quotes: QuoteEvent[];
  /** Assets demanded on-chain this cycle. */
  assets: number[];
  ticks: RecordedTick[];
  /** Assets whose push failed even after the retry; the cycle for them is a gap. */
  gaps: number[];
  verdicts: Record<number, OracleHealth>;
}

/** A push slower than this is logged. */
const SLOW_PUSH_MS = 2_000;

const RELEASE_IF_OWNER = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
const RENEW_IF_OWNER = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;

/**
 * Each cycle, on the leader: refresh display quotes for every market, push the demanded ones on-chain as ticks in
 * one `push_ticks` transaction, publish them, and keep the oracle verdict. Idle markets are never pushed.
 */
@Injectable()
export class PricePusherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PricePusherService.name);
  private readonly instanceId = randomUUID();
  private timer?: NodeJS.Timeout;
  private running = false;
  /** Publish time last sent on-chain per asset; an unchanged quote is not sent again. */
  private readonly lastPushed = new Map<number, number>();
  /** False without a pusher gas key: display quotes still flow, nothing is written on-chain. */
  private canPush = false;

  constructor(
    private readonly redis: RedisService,
    private readonly near: NearService,
    private readonly config: ConfigService<Env, true>,
    private readonly params: ParamsService,
    private readonly active: ActiveAssetsService,
    private readonly sink: TickSink,
    private readonly quotes: QuoteService,
    @Inject(PRICE_PROVIDER) private readonly provider: PriceProvider,
    @Inject(ORACLE_WRITER) private readonly writer: OracleWriter,
  ) {}

  onModuleInit() {
    if (!this.config.get('PRICE_PUSHER_ENABLED', { infer: true })) return;
    this.canPush = this.near.hasSigner('pusher');
    if (!this.canPush) {
      if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
        throw new Error(
          'PUSHER_GAS_KEY is required in production while PRICE_PUSHER_ENABLED is true',
        );
      }
      this.logger.warn('PUSHER_GAS_KEY is not set: display quotes only, no on-chain ticks');
    }
    const interval = this.config.get('PRICE_PUSH_INTERVAL_MS', { infer: true });
    this.logger.log(
      `Price pusher ${this.instanceId} starting, source ${this.config.get('PRICE_SOURCE', { infer: true })}, every ${interval} ms`,
    );
    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.provider.close?.();
    await this.sink.flush();
    await this.redis.client
      .eval(RELEASE_IF_OWNER, 1, ORACLE_KEYS.pusherLock, this.instanceId)
      .catch(() => undefined);
  }

  private async tick() {
    try {
      await this.runCycle();
      await this.sink.flush();
    } catch (err) {
      this.logger.error(`Price cycle failed: ${(err as Error).message}`);
    }
  }

  async runCycle(now: Date = new Date()): Promise<CycleReport> {
    const report: CycleReport = {
      leader: false,
      quotes: [],
      assets: [],
      ticks: [],
      gaps: [],
      verdicts: {},
    };
    if (this.running) return report;
    this.running = true;
    try {
      if (!(await this.holdLock())) return report;
      report.leader = true;

      report.quotes = await this.quotes.refresh().catch((err: Error) => {
        this.logger.warn(`Quote refresh failed: ${err.message}`);
        return [];
      });

      const assets = await this.active.resolve(now);
      report.assets = assets.map((a) => a.assetId);
      if (assets.length === 0 || !this.canPush) return report;

      const chainNow = await this.chainTime();
      const { ticks, gaps } = await this.timedPush(assets);
      report.ticks = ticks;
      report.gaps = gaps;
      await this.sink.publish(ticks);
      report.verdicts = await this.evaluate(assets, ticks, chainNow);
      return report;
    } finally {
      this.running = false;
    }
  }

  /**
   * A push waits for the transaction, which can take many seconds on a slow RPC. Meanwhile the lock keeps being
   * renewed and display quotes keep refreshing, so a slow push never makes a market look stale or hands the
   * lock to a standby. A slow push is logged with its duration.
   */
  private async timedPush(assets: ActiveAsset[]) {
    const startedAt = Date.now();
    const interval = this.config.get('PRICE_PUSH_INTERVAL_MS', { infer: true });
    const heartbeat = setInterval(() => {
      void this.holdLock().catch(() => undefined);
      void this.quotes.refresh().catch((err: Error) => {
        this.logger.warn(`Quote refresh failed during a push: ${err.message}`);
      });
    }, interval);
    try {
      return await this.pushWithRetry(assets);
    } finally {
      clearInterval(heartbeat);
      const took = Date.now() - startedAt;
      if (took >= SLOW_PUSH_MS) {
        this.logger.warn(
          `push_ticks for assets ${assets.map((a) => a.assetId).join(', ')} took ${took} ms`,
        );
      }
    }
  }

  /** One immediate retry with more gas and a fresh price; what still fails is a gap. */
  private async pushWithRetry(assets: ActiveAsset[]) {
    const updates = this.updatesFor(assets);
    if (updates.length === 0) return { ticks: [], gaps: [] };
    const first = await this.pushBounded(updates);
    const ticks = [...first.ticks];
    let failedIds = first.failed.map((f) => f.assetId);

    if (failedIds.length > 0) {
      this.logger.warn(`Push failed for assets ${failedIds.join(', ')}, retrying with more gas`);
      const retry = await this.pushBounded(
        this.updatesFor(assets.filter((a) => failedIds.includes(a.assetId))),
        { gasMultiplier: 1.5 },
      );
      ticks.push(...retry.ticks);
      failedIds = retry.failed.map((f) => f.assetId);
      for (const f of retry.failed) this.logger.error(`Gap for asset ${f.assetId}: ${f.error}`);
    }
    for (const t of ticks) this.lastPushed.set(t.assetId, t.publishMs);
    return { ticks, gaps: failedIds };
  }

  /**
   * One push, but never longer than `PRICE_PUSH_TIMEOUT_MS`. A transaction can hang for tens of seconds on the
   * testnet; waiting for it would leave the oracle without ticks and void running duels. On timeout the push counts
   * as failed, so the retry sends a fresh price right away on another lane. The stuck transaction is left to
   * finish on its own: the arena ignores a tick whose publish time does not advance.
   */
  private async pushBounded(
    updates: TickUpdate[],
    options?: { gasMultiplier?: number },
  ): Promise<PushResult> {
    if (updates.length === 0) return { ticks: [], failed: [] };
    const limitMs = this.config.get('PRICE_PUSH_TIMEOUT_MS', { infer: true }) ?? 6_000;
    const attempt = this.writer.push(updates, options);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<PushResult>((resolve) => {
      timer = setTimeout(() => {
        this.logger.warn(`push_ticks still pending after ${limitMs} ms, sending a fresh one`);
        resolve({
          ticks: [],
          failed: updates.map((u) => ({ assetId: u.assetId, error: 'timeout' })),
        });
      }, limitMs);
    });
    attempt.catch(() => undefined);
    try {
      return await Promise.race([attempt, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The latest quote of each asset, skipping assets whose quote has not moved since the last push. */
  private updatesFor(assets: ActiveAsset[]): TickUpdate[] {
    return assets.flatMap((a) => {
      const p = this.quotes.latest(a.assetId);
      if (!p) {
        this.logger.warn(`No price for asset ${a.assetId} yet`);
        return [];
      }
      if (p.publishMs <= (this.lastPushed.get(a.assetId) ?? 0)) return [];
      return [
        {
          assetId: a.assetId,
          feedId: a.feedId,
          price: p.price,
          expo: p.expo,
          publishMs: p.publishMs,
        },
      ];
    });
  }

  /** Verdict per asset, transitions published once, and void signals for running duels on an outage. */
  private async evaluate(assets: ActiveAsset[], ticks: RecordedTick[], chainNow: number) {
    const limits = {
      maxStalenessMs: this.params.oracle.maxStalenessMs,
      voidAfterOutageMs: this.params.oracle.voidAfterOutageMs,
    };
    const latest = new Map(ticks.map((t) => [t.assetId, t]));
    const verdicts: Record<number, OracleHealth> = {};

    for (const { assetId } of assets) {
      const raw = await this.redis.client.get(ORACLE_KEYS.state(assetId));
      const previous = raw ? (JSON.parse(raw) as OracleState) : null;
      const tick = latest.get(assetId);

      const next: OracleState = {
        lastTickIndex: tick?.tickIndex ?? previous?.lastTickIndex ?? null,
        // With no tick ever seen, age is counted from the first evaluation so a dead feed still reaches outage.
        lastPublishMs: tick?.publishMs ?? previous?.lastPublishMs ?? chainNow,
        evaluatedAt: chainNow,
        status: 'ok',
      };
      next.status = oracleVerdict(next.lastPublishMs, chainNow, limits);
      verdicts[assetId] = next.status;

      const before: OracleHealth = previous?.status ?? 'ok';
      if (before !== next.status) await this.publishTransition(assetId, before, next);
      await this.redis.client.set(ORACLE_KEYS.state(assetId), JSON.stringify(next), 'EX', 60);

      if (next.status === 'outage') await this.signalVoid(assetId, chainNow);
    }
    return verdicts;
  }

  private async publishTransition(assetId: number, from: OracleHealth, state: OracleState) {
    this.logger.warn(`Oracle ${assetId}: ${from} -> ${state.status}`);
    await this.redis.publish(ORACLE_KEYS.statusChannel(assetId), {
      assetId,
      from,
      to: state.status,
      at: state.evaluatedAt,
    });
    const event: OracleHealthEvent = {
      assetId,
      status: state.status,
      lastPublishMs: state.lastPublishMs,
    };
    await this.redis.publish(CHANNELS.price(assetId), {
      event: WS_EVENTS.oracleHealth,
      data: event,
    });
  }

  private async signalVoid(assetId: number, at: number) {
    const duelIds = await this.active.runningDuelIds(assetId);
    const fresh: string[] = [];
    for (const id of duelIds) {
      // SADD returns 1 only the first time, so each duel is signaled once per outage.
      if ((await this.redis.client.sadd(ORACLE_KEYS.voidSignaled, id.toString())) === 1) {
        fresh.push(id.toString());
      }
    }
    if (fresh.length === 0) return;
    await this.redis.client.expire(ORACLE_KEYS.voidSignaled, 3600);
    await this.redis.publish(ORACLE_KEYS.voidChannel, { assetId, duelIds: fresh, at });
  }

  private async holdLock(): Promise<boolean> {
    const ttl = this.config.get('PRICE_LOCK_TTL_MS', { infer: true });
    const renewed = await this.redis.client.eval(
      RENEW_IF_OWNER,
      1,
      ORACLE_KEYS.pusherLock,
      this.instanceId,
      ttl,
    );
    if (renewed === 1) return true;
    const acquired = await this.redis.client.set(
      ORACLE_KEYS.pusherLock,
      this.instanceId,
      'PX',
      ttl,
      'NX',
    );
    return acquired === 'OK';
  }

  /** Time of the latest NEAR block in ms, so the worker's clock never decides staleness. */
  private async chainTime(): Promise<number> {
    const status = await this.near.near.getStatus();
    const at = Date.parse(status.sync_info.latest_block_time);
    return Number.isFinite(at) ? at : Date.now();
  }
}
