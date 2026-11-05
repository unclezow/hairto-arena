import { Injectable } from '@nestjs/common';
import { Dir, type DuelSnapshotEvent } from '@hairto-arena/shared';
import { isEncryptedSeed } from '../bot/seed-crypto.js';
import { normalizeSeed, seedToBase64 } from '../bot/seed.js';
import { ParamsService } from '../config/params.service.js';
import { DuelStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { ORACLE_KEYS } from '../price/oracle-keys.js';
import {
  DuelLiveStore,
  isLiveTerminal,
  liveHp,
  type DuelLive,
  type LiveStatus,
} from './duel-live.js';

export interface DuelAccessInfo {
  fighter: string;
  terminal: boolean;
}

/** Ticks included in a snapshot, newest last. A 30 s round has about 33 including the countdown. */
const SNAPSHOT_TICKS = 40;

const STATUS: Record<DuelStatus, LiveStatus> = {
  [DuelStatus.CREATED]: 'created',
  [DuelStatus.ACTIVE]: 'active',
  [DuelStatus.FINISHED]: 'finished',
  [DuelStatus.FORFEITED]: 'forfeited',
  [DuelStatus.VOIDED]: 'voided',
};

/** Builds `duel:snapshot` from the live state, falling back to the database for duels the watcher never saw. */
@Injectable()
export class SnapshotService {
  constructor(
    private readonly live: DuelLiveStore,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly params: ParamsService,
  ) {}

  async build(
    duelId: string,
  ): Promise<{ snapshot: DuelSnapshotEvent; access: DuelAccessInfo } | null> {
    // Read the sequence first: events published while the snapshot is built then count as newer than it.
    const seq = await this.live.currentSeq(duelId);
    const live = (await this.live.get(duelId)) ?? (await this.fromDatabase(duelId));
    if (!live) return null;

    const hp = live.positions.length
      ? liveHp(live, this.params.duel.startingHp)
      : { fighter: this.params.duel.startingHp, bot: this.params.duel.startingHp };

    const snapshot: DuelSnapshotEvent = {
      duelId,
      seq,
      status: live.status,
      fighter: live.fighter,
      botLevel: live.botLevel,
      assetId: live.assetId,
      startMs: live.startMs,
      hp,
      positions: live.positions.map((p) => ({
        player: p.player,
        isBot: p.isBot,
        state: p.state,
        tick: p.tick,
        ...(p.state === 'closed'
          ? {
              dir: p.dir ?? null,
              pnlPpm: p.pnlPpm,
              selfDelta: p.selfDelta,
              opponentDelta: p.opponentDelta,
              penalized: p.penalized ?? false,
            }
          : {}),
      })),
      ticks: await this.ticksSince(live),
      winner: live.winner,
      ko: live.ko,
    };
    return { snapshot, access: { fighter: live.fighter, terminal: isLiveTerminal(live.status) } };
  }

  private async ticksSince(live: DuelLive) {
    const entries = await this.redis.client.xrevrange(
      ORACLE_KEYS.tickStream(live.assetId),
      '+',
      '-',
      'COUNT',
      SNAPSHOT_TICKS,
    );
    return entries
      .map(([, fields]) => {
        const f: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) f[fields[i]!] = fields[i + 1]!;
        return {
          tickIndex: Number(f.tickIndex),
          price: f.price!,
          publishMs: Number(f.publishMs),
        };
      })
      .reverse()
      .filter((t) => live.startMs === null || t.publishMs >= live.startMs);
  }

  private async fromDatabase(duelId: string): Promise<DuelLive | null> {
    if (!/^\d{1,30}$/.test(duelId)) return null;
    const duel = await this.prisma.duel.findUnique({
      where: { id: BigInt(duelId) },
      include: { bot: true, positions: true, botSeed: true },
    });
    if (!duel) return null;

    return {
      duelId,
      status: STATUS[duel.status],
      fighter: duel.fighterAddress,
      bot: duel.bot.address,
      botLevel: duel.bot.level,
      assetId: duel.assetId,
      startMs: duel.startAt ? duel.startAt.getTime() : null,
      positions: duel.positions.map((p) => {
        const closed = p.closedAt !== null;
        return {
          player: p.player,
          isBot: p.isBot,
          state: closed ? ('closed' as const) : ('opened' as const),
          tick: p.openTick,
          ...(closed
            ? {
                ...(p.dir === null ? {} : { dir: p.dir === 'LONG' ? Dir.Long : Dir.Short }),
                pnlPpm: p.pnlPpm ?? 0,
                selfDelta: p.selfDelta ?? 0,
                opponentDelta: p.opponentDelta ?? 0,
                penalized: p.penalized,
              }
            : {}),
        };
      }),
      winner: duel.winner,
      ko: duel.ko,
      seed:
        duel.botSeed?.revealedAt && duel.botSeed.seed && !isEncryptedSeed(duel.botSeed.seed)
          ? seedToBase64(normalizeSeed(duel.botSeed.seed))
          : null,
    };
  }
}
