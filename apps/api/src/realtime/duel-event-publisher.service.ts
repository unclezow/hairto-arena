import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BOT_CHARACTER_BY_LEVEL, DEFAULT_CHARACTER_ID, WS_EVENTS } from '@hairto-arena/shared';
import { LeaderLock } from '../common/leader-lock.js';
import type { Env } from '../config/env.js';
import { ParamsService } from '../config/params.service.js';
import { RedisService } from '../redis/redis.service.js';
import { ONCHAIN_TTL_SEC, onchainKey, stepOf } from '../duels/onchain-steps.js';
import { CHANNELS } from './channels.js';
import {
  DUEL_EVENT_SOURCE,
  type ChainDuelEvent,
  type ChainDuelInfo,
  type DuelEventSource,
} from './duel-chain-events.js';
import { DuelLiveStore, liveHp, type DuelLive } from './duel-live.js';

export const CURSOR_KEY = 'realtime:events:cursor';
const LOCK_KEY = 'realtime:events:lock';
const seenKey = (ev: ChainDuelEvent) => `realtime:events:seen:${ev.txHash}:${ev.logIndex}`;
/** Most blocks read in one run, so catching up after downtime stays bounded. */
const MAX_BLOCKS_PER_RUN = 500n;
/**
 * Further behind than this, the cursor jumps to `head - MAX_BLOCKS_PER_RUN`: a duel lasts under a minute, so live
 * events that old reach no one, and the indexer keeps the history. Without it a long outage never catches up.
 */
const MAX_LAG_BLOCKS = 2_000n;

export interface PublishReport {
  leader: boolean;
  /** Chain events handled in this run. */
  handled: number;
}

const lower = (a: string) => a.toLowerCase();

/**
 * Follows the arena's duel events and publishes them in realtime. One instance leads
 * at a time; it reads blocks from a cursor kept in Redis, so a standby resumes where the leader stopped, and
 * every event is deduplicated by (tx, log). The events are provisional: the indexed record comes seconds later.
 */
@Injectable()
export class DuelEventPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DuelEventPublisher.name);
  private readonly lock: LeaderLock;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly redis: RedisService,
    private readonly live: DuelLiveStore,
    private readonly params: ParamsService,
    private readonly config: ConfigService<Env, true>,
    @Inject(DUEL_EVENT_SOURCE) private readonly source: DuelEventSource,
  ) {
    this.lock = new LeaderLock(
      redis,
      LOCK_KEY,
      Math.max(5000, 3 * config.get('REALTIME_EVENTS_INTERVAL_MS', { infer: true })),
    );
  }

  onModuleInit() {
    if (!this.config.get('REALTIME_EVENTS_ENABLED', { infer: true })) return;
    this.timer = setInterval(
      () =>
        void this.runOnce().catch((e: Error) => this.logger.warn(`Event run failed: ${e.message}`)),
      this.config.get('REALTIME_EVENTS_INTERVAL_MS', { infer: true }),
    );
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.lock.release();
  }

  async runOnce(): Promise<PublishReport> {
    const report: PublishReport = { leader: false, handled: 0 };
    if (this.running) return report;
    this.running = true;
    try {
      if (!(await this.lock.hold())) return report;
      report.leader = true;

      const head = await this.source.head();
      const stored = await this.redis.client.get(CURSOR_KEY);
      if (stored === null) {
        // First start: follow from now on. Replaying history would announce duels that ended long ago.
        await this.redis.client.set(CURSOR_KEY, head.toString());
        return report;
      }

      let from = BigInt(stored) + 1n;
      if (from > head) return report;
      if (head - from > MAX_LAG_BLOCKS) {
        const skipTo = head - MAX_BLOCKS_PER_RUN + 1n;
        this.logger.warn(`Live events ${head - from} blocks behind; skipping to block ${skipTo}`);
        from = skipTo;
      }
      const to = head < from + MAX_BLOCKS_PER_RUN - 1n ? head : from + MAX_BLOCKS_PER_RUN - 1n;

      for (const event of await this.source.fetch(from, to)) {
        // Whoever marks the event first publishes it; a repeat (or a second leader after a failover) skips it.
        const first = await this.redis.client.set(seenKey(event), '1', 'EX', 600, 'NX');
        if (first !== 'OK') continue;
        try {
          await this.handle(event);
          report.handled++;
        } catch (err) {
          // Let the next run try again instead of losing the event.
          await this.redis.client.del(seenKey(event));
          throw err;
        }
      }
      await this.redis.client.set(CURSOR_KEY, to.toString());
      return report;
    } finally {
      this.running = false;
    }
  }

  private async handle(ev: ChainDuelEvent) {
    const duelId = ev.id.toString();
    let live = await this.live.get(duelId);

    if (!live) {
      const info = await this.source.loadDuel(ev.id);
      if (!info) {
        this.logger.warn(`Duel ${duelId}: no chain data, event ${ev.kind} dropped`);
        return;
      }
      live = this.fresh(duelId, info);
    }

    // Keep the transaction for the on-chain log; the indexer fills the same list in later, authoritatively.
    const key = onchainKey(duelId);
    await this.redis.client
      .multi()
      .rpush(key, JSON.stringify(stepOf(ev, live.bot)))
      .expire(key, ONCHAIN_TTL_SEC)
      .exec()
      .catch(() => undefined);

    switch (ev.kind) {
      case 'created':
        await this.emit(duelId, live, WS_EVENTS.duelStarted, {
          fighter: live.fighter,
          botLevel: live.botLevel ?? 0,
          assetId: live.assetId,
          startMs: live.startMs ?? 0,
          fighterCharacter: live.fighterCharacter ?? DEFAULT_CHARACTER_ID,
          botCharacter: BOT_CHARACTER_BY_LEVEL[live.botLevel ?? 1] ?? DEFAULT_CHARACTER_ID,
        });
        return;

      case 'positionOpened': {
        const player = lower(ev.player);
        live.positions.push({ player, isBot: player === live.bot, state: 'opened', tick: ev.tick });
        live.status = 'active';
        await this.emit(duelId, live, WS_EVENTS.duelPosition, {
          player,
          isBot: player === live.bot,
          state: 'opened',
          tick: ev.tick,
        });
        return;
      }

      case 'positionClosed':
      case 'positionPenalized': {
        const player = lower(ev.player);
        const open = [...live.positions]
          .reverse()
          .find((p) => p.player === player && p.state === 'opened');
        const closed = {
          dir: ev.kind === 'positionClosed' ? (ev.dir as 1 | 2) : null,
          pnlPpm: ev.pnlPpm,
          selfDelta: ev.selfDelta,
          opponentDelta: ev.opponentDelta,
          penalized: ev.kind === 'positionPenalized',
        };
        const stored = { ...closed, dir: closed.dir ?? undefined };
        if (open) Object.assign(open, { state: 'closed' as const, ...stored });
        else
          live.positions.push({
            player,
            isBot: player === live.bot,
            state: 'closed',
            tick: null,
            ...stored,
          });

        await this.emit(duelId, live, WS_EVENTS.duelPosition, {
          player,
          isBot: player === live.bot,
          state: 'closed',
          tick: open?.tick ?? null,
          ...closed,
        });
        const hp = liveHp(live, this.params.duel.startingHp);
        await this.emit(duelId, live, WS_EVENTS.hpUpdate, {
          hpFighter: hp.fighter,
          hpBot: hp.bot,
          lastClosed: { player, ...closed },
        });
        return;
      }

      case 'finished':
        live.status = 'finished';
        live.winner = ev.winner === null ? null : lower(ev.winner);
        live.ko = ev.ko;
        await this.emit(duelId, live, WS_EVENTS.duelResult, { winner: live.winner, ko: ev.ko });
        return;

      case 'forfeited':
        live.status = 'forfeited';
        live.winner = lower(ev.loser) === live.fighter ? live.bot : live.fighter;
        await this.emit(duelId, live, WS_EVENTS.duelResult, { winner: live.winner, ko: false });
        return;

      case 'voided':
        live.status = 'voided';
        await this.emit(duelId, live, WS_EVENTS.duelVoided, {});
        return;

      case 'seedRevealed':
        live.seed = ev.seed;
        await this.emit(duelId, live, WS_EVENTS.duelSeed, { seed: ev.seed });
        return;
    }
  }

  private fresh(duelId: string, info: ChainDuelInfo): DuelLive {
    return {
      duelId,
      status: 'created',
      fighter: lower(info.fighter),
      bot: lower(info.bot),
      botLevel: info.botLevel,
      assetId: info.assetId,
      startMs: info.startMs,
      fighterCharacter: info.fighterCharacter,
      positions: [],
      winner: null,
      ko: false,
      seed: null,
    };
  }

  /** Saves the state, numbers the event and publishes it. The number is taken after the state is saved. */
  private async emit(duelId: string, live: DuelLive, event: string, data: Record<string, unknown>) {
    await this.live.save(live);
    const seq = await this.live.nextSeq(duelId);
    await this.redis.publish(CHANNELS.duel(duelId), {
      event,
      data: { duelId, seq, provisional: true, ...data },
    });
  }
}
