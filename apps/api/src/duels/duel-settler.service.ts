import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env.js';
import { ParamsService } from '../config/params.service.js';
import { DuelStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ORACLE_KEYS } from '../price/oracle-keys.js';
import { RedisService } from '../redis/redis.service.js';
import { SETTLER_CHAIN, type SettlerChain } from './settler-chain.js';

export interface SettleReport {
  settled: number[];
  forfeited: number[];
  voided: number[];
  /** Terminal duels deleted because their seed was not revealed in time. */
  pruned: number[];
  /** Duels that are still not terminal long after their round, and keep failing to settle. */
  stuck: number[];
}

const TERMINAL = new Set(['Finished', 'Forfeited', 'Voided']);
/** The arena accepts `settle_duel` from `effective_end_ms`; the margin leaves room for late reveals. */
const SETTLE_MARGIN_MS = 10_000;
/** Recorded duels older than this cannot still be open, so the loop does not look at them. */
const LOOKBACK_MS = 24 * 60 * 60_000;

const lockKey = (id: bigint) => `duel:settle:${id}`;
/** A lock this short throttles retries of a failing call without blocking the next healthy duel. */
const LOCK_SEC = 20;
export const STUCK_SET = 'duel:stuck';

/**
 * Drives every recorded duel to a terminal state with `settle_duel` / `void_duel`, and prunes duels whose seed was
 * lost. All of them are permissionless on-chain, so this worker is a convenience, not a gatekeeper. Each call is
 * guarded by an on-chain status check and a per-duel Redis lock, so several workers never send the same one.
 */
@Injectable()
export class DuelSettler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DuelSettler.name);
  private timer?: NodeJS.Timeout;
  private subscriber?: Redis;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly params: ParamsService,
    private readonly config: ConfigService<Env, true>,
    @Inject(SETTLER_CHAIN) private readonly chain: SettlerChain,
  ) {}

  async onModuleInit() {
    if (!this.config.get('DUELS_ENABLED', { infer: true })) {
      // The flag only stops new duels; a paused system must still finish the duels that exist.
      this.logger.log('DUELS_ENABLED is off by default, the settler still runs');
    }
    const interval = this.config.get('DUEL_SETTLE_INTERVAL_MS', { infer: true });
    this.timer = setInterval(
      () => void this.runOnce().catch((e: Error) => this.logger.error(e.message)),
      interval,
    );
    this.timer.unref();

    this.subscriber = this.redis.createSubscriber();
    this.subscriber.on('message', (_c, message) => void this.onVoidSignal(message));
    await this.subscriber.subscribe(ORACLE_KEYS.voidChannel).catch((err: Error) => {
      this.logger.warn(`Redis unavailable, void signals disabled: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.subscriber?.quit().catch(() => undefined);
  }

  async runOnce(now = new Date()): Promise<SettleReport> {
    const report: SettleReport = { settled: [], forfeited: [], voided: [], pruned: [], stuck: [] };
    if (this.running) return report;
    this.running = true;
    try {
      const roundMs = this.params.duel.roundDurationMs;
      const graceMs = this.params.duel.revealGraceMs;
      const stuckMs = this.config.get('DUEL_STUCK_AFTER_SEC', { infer: true }) * 1000;

      const open = await this.prisma.duel.findMany({
        where: {
          status: { in: [DuelStatus.CREATED, DuelStatus.ACTIVE] },
          startAt: { gt: new Date(now.getTime() - LOOKBACK_MS) },
        },
        select: { id: true, startAt: true },
      });

      for (const duel of open) {
        // Cheap filter before any RPC: the arena's own end time can only be later than this.
        const earliest = duel.startAt!.getTime() + roundMs + graceMs;
        if (now.getTime() < earliest) continue;
        await this.settle(duel.id, now, now.getTime() - earliest > stuckMs, report);
      }

      const lost = await this.prisma.botSeed.findMany({
        where: { unrevealedAt: { not: null }, revealedAt: null },
        select: { duelId: true },
      });
      for (const { duelId } of lost) await this.prune(duelId, now, report);
      return report;
    } finally {
      this.running = false;
    }
  }

  private async settle(id: bigint, now: Date, overdue: boolean, report: SettleReport) {
    const duel = await this.chain.getDuel(id).catch(() => undefined);
    if (duel === undefined) return;
    if (duel === null || TERMINAL.has(duel.status)) {
      await this.redis.client.srem(STUCK_SET, id.toString());
      return;
    }
    if (now.getTime() < duel.effectiveEndMs + SETTLE_MARGIN_MS) return;
    if (!(await this.acquire(id))) return;
    try {
      // settle_duel forfeits a Fighter who never opened a position and voids on an oracle outage.
      await this.chain.settleDuel(id);
      const after = await this.chain.getDuel(id);
      if (after?.status === 'Forfeited') report.forfeited.push(Number(id));
      else if (after?.status === 'Voided') report.voided.push(Number(id));
      else report.settled.push(Number(id));
    } catch (err) {
      this.logger.warn(`Duel ${id}: could not settle yet: ${(err as Error).message}`);
      if (overdue) {
        await this.redis.client.sadd(STUCK_SET, id.toString());
        this.logger.error(`Duel ${id} is stuck: still not settled long after its round`);
        report.stuck.push(Number(id));
      }
    }
  }

  /** Deletes a terminal duel whose seed was never revealed, once the arena's reveal timeout has passed. */
  private async prune(id: bigint, now: Date, report: SettleReport) {
    const duel = await this.chain.getDuel(id).catch(() => undefined);
    if (!duel || !TERMINAL.has(duel.status) || duel.settledMs === null) return;
    if (now.getTime() <= duel.settledMs + this.params.duel.seedRevealTimeoutMs) return;
    if (!(await this.acquire(id))) return;
    try {
      await this.chain.pruneDuel(id);
      report.pruned.push(Number(id));
    } catch (err) {
      this.logger.warn(`Duel ${id}: could not prune yet: ${(err as Error).message}`);
    }
  }

  /** Voids the given duels because the oracle was in outage. */
  async voidDuels(ids: bigint[]): Promise<SettleReport> {
    const report: SettleReport = { settled: [], forfeited: [], voided: [], pruned: [], stuck: [] };
    for (const id of ids) {
      if (!(await this.acquire(id))) continue;
      try {
        const duel = await this.chain.getDuel(id);
        if (!duel || TERMINAL.has(duel.status)) continue;
        await this.chain.voidDuel(id);
        report.voided.push(Number(id));
      } catch (err) {
        this.logger.warn(`Duel ${id}: could not void yet: ${(err as Error).message}`);
      }
    }
    return report;
  }

  private async onVoidSignal(message: string) {
    try {
      const { duelIds } = JSON.parse(message) as { assetId: number; duelIds: string[] };
      await this.voidDuels(duelIds.map((id) => BigInt(id)));
    } catch (err) {
      this.logger.warn(`Dropped a void signal: ${(err as Error).message}`);
    }
  }

  private async acquire(id: bigint): Promise<boolean> {
    return (await this.redis.client.set(lockKey(id), '1', 'EX', LOCK_SEC, 'NX')) === 'OK';
  }
}
