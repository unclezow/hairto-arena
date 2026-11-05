import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { WS_EVENTS } from '@hairto-arena/shared';
import { LeaderLock } from '../common/leader-lock.js';
import { ParamsService } from '../config/params.service.js';
import { CHANNELS } from '../realtime/channels.js';
import { LEADERBOARD_VERSION_KEY } from '../redis/keys.js';
import { RedisService } from '../redis/redis.service.js';
import { ScoreboardService } from '../read-model/scoreboard.service.js';
import { SeasonLookup } from '../read-model/season-lookup.service.js';

/** Entries pushed to clients; the full table is a REST call away. */
export const PUSHED_ENTRIES = 20;
const PUBLISHED_VERSION_KEY = 'leaderboard:published-version';
const PUBLISHED_HASH_KEY = 'leaderboard:published-hash';
const CHECK_INTERVAL_MS = 2000;

/**
 * Pushes the top of the leaderboard to the season room when scores changed.
 * The sync job bumps a version whenever it copies scores; this only publishes when the version moved and the top
 * entries really differ, and only one worker does it at a time.
 */
@Injectable()
export class LeaderboardPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeaderboardPublisher.name);
  private readonly lock: LeaderLock;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly redis: RedisService,
    private readonly seasons: SeasonLookup,
    private readonly scoreboard: ScoreboardService,
    private readonly params: ParamsService,
  ) {
    this.lock = new LeaderLock(redis, 'leaderboard:publisher:lock', 3 * CHECK_INTERVAL_MS);
  }

  onModuleInit() {
    this.timer = setInterval(
      () =>
        void this.runOnce().catch((e: Error) =>
          this.logger.warn(`Leaderboard push failed: ${e.message}`),
        ),
      CHECK_INTERVAL_MS,
    );
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.lock.release();
  }

  /** Returns true when a message was published. */
  async runOnce(): Promise<boolean> {
    if (!(await this.lock.hold())) return false;

    // No version yet means the sync job has not copied any score: nothing has changed.
    const version = await this.redis.client.get(LEADERBOARD_VERSION_KEY);
    if (version === null || version === (await this.redis.client.get(PUBLISHED_VERSION_KEY)))
      return false;

    const season = await this.seasons.current();
    if (!season) return false;
    const entries = await this.scoreboard.ranked(
      season.id,
      this.params.score.minDuelsForLeaderboard,
      0,
      PUSHED_ENTRIES,
    );

    // A version bump does not mean the top changed (a duel in the middle of the table, a replayed row).
    const hash = createHash('sha256')
      .update(JSON.stringify([season.id, entries]))
      .digest('hex');
    await this.redis.client.set(PUBLISHED_VERSION_KEY, version);
    if (hash === (await this.redis.client.get(PUBLISHED_HASH_KEY))) return false;

    await this.redis.publish(CHANNELS.season(season.id), {
      event: WS_EVENTS.seasonLeaderboard,
      data: { seasonId: season.id, entries },
    });
    await this.redis.client.set(PUBLISHED_HASH_KEY, hash);
    return true;
  }
}
