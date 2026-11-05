import { Injectable } from '@nestjs/common';
import type { Dir } from '@hairto-arena/shared';
import { RedisService } from '../redis/redis.service.js';

export type LiveStatus = 'created' | 'active' | 'finished' | 'forfeited' | 'voided';

export interface LivePosition {
  player: string;
  isBot: boolean;
  state: 'opened' | 'closed';
  tick: number | null;
  dir?: Dir;
  /** Net PnL in ppm as the arena scored it. */
  pnlPpm?: number;
  /** HP deltas from `position_closed` / `position_penalized`. */
  selfDelta?: number;
  opponentDelta?: number;
  /** Never revealed: charged the penalty at settle, so it has a result but no direction. */
  penalized?: boolean;
}

/** What the live event source knows about a duel right now, kept in Redis so any process can read it. */
export interface DuelLive {
  duelId: string;
  status: LiveStatus;
  fighter: string;
  bot: string;
  botLevel: number | null;
  assetId: number;
  startMs: number | null;
  /** Cosmetic, 0 = default; absent on live state saved before characters existed. */
  fighterCharacter?: number;
  positions: LivePosition[];
  winner: string | null;
  ko: boolean;
  seed: string | null;
}

export const isLiveTerminal = (status: LiveStatus) =>
  status === 'finished' || status === 'forfeited' || status === 'voided';

/** Expiry of the live state; a duel is long over by then and REST serves it from the database. */
const LIVE_TTL_SEC = 24 * 60 * 60;
const liveKey = (id: string) => `duel:live:${id}`;
const seqKey = (id: string) => `duel:seq:${id}`;

@Injectable()
export class DuelLiveStore {
  constructor(private readonly redis: RedisService) {}

  async get(duelId: string): Promise<DuelLive | null> {
    const raw = await this.redis.client.get(liveKey(duelId));
    return raw ? (JSON.parse(raw) as DuelLive) : null;
  }

  async save(live: DuelLive): Promise<void> {
    await this.redis.client.set(liveKey(live.duelId), JSON.stringify(live), 'EX', LIVE_TTL_SEC);
  }

  /** The next event number of a duel (1, 2, 3, ...). */
  async nextSeq(duelId: string): Promise<number> {
    const seq = await this.redis.client.incr(seqKey(duelId));
    await this.redis.client.expire(seqKey(duelId), LIVE_TTL_SEC);
    return seq;
  }

  async currentSeq(duelId: string): Promise<number> {
    return Number((await this.redis.client.get(seqKey(duelId))) ?? 0);
  }
}

/**
 * HP from the deltas the contract emitted, applied in event order and clamped like the arena does.
 * An open position has no revealed result and changes nothing.
 */
export function liveHp(live: DuelLive, startingHp: number) {
  const hp = { fighter: startingHp, bot: startingHp };
  const clamp = (v: number) => Math.min(startingHp, Math.max(0, v));
  for (const p of live.positions) {
    if (p.state !== 'closed' || p.selfDelta === undefined || p.opponentDelta === undefined)
      continue;
    const self = p.isBot ? 'bot' : 'fighter';
    const other = p.isBot ? 'fighter' : 'bot';
    hp[self] = clamp(hp[self] + p.selfDelta);
    hp[other] = clamp(hp[other] + p.opponentDelta);
  }
  return hp;
}
