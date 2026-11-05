import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { INDEXER_LAG_KEY, LEADERBOARD_VERSION_KEY } from '../redis/keys.js';
import { RedisService } from '../redis/redis.service.js';
import {
  DependencyMissing,
  SYNC_TABLES,
  type RowPosition,
  type SyncContext,
  type TableSync,
} from './sync-tables.js';

export interface SyncReport {
  skipped?: 'busy' | 'no-indexer';
  /** Rows copied per table in this run. */
  copied: Record<string, number>;
  /** Tables that stopped early because a parent row is not copied yet. */
  stalled: string[];
  lag: bigint | null;
}

export interface ConsistencyMismatch {
  table: string;
  indexer: number;
  api: number;
}

/**
 * Copies rows from the indexer's schema `chain` into the Prisma read model. The indexer only writes final blocks,
 * so every row is final. Idempotent upserts keyed by natural keys, a persisted cursor per table
 * `(block_height, log_index)`, and a replay window before the cursor.
 */
@Injectable()
export class IndexerSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IndexerSyncService.name);
  private readonly schema: string;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.schema = config.get('INDEXER_SCHEMA', { infer: true });
  }

  onModuleInit() {
    if (!this.config.get('SYNC_ENABLED', { infer: true })) return;
    const interval = this.config.get('SYNC_INTERVAL_MS', { infer: true });
    this.timer = setInterval(() => void this.runOnce(), interval);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<SyncReport> {
    const report: SyncReport = { copied: {}, stalled: [], lag: null };
    if (this.running) return { ...report, skipped: 'busy' };
    this.running = true;
    try {
      const ctx = this.context();
      for (const table of SYNC_TABLES) {
        try {
          report.copied[table.name] = await this.syncTable(table, ctx, report);
        } catch (err) {
          if (isMissingRelation(err)) {
            // The indexer has not created its schema yet (not started, or still migrating).
            this.logger.warn(`Indexer schema "${this.schema}" not ready, skipping sync`);
            return { ...report, skipped: 'no-indexer' };
          }
          throw err;
        }
      }

      if ((report.copied.fighter_score ?? 0) > 0 || (report.copied.duel ?? 0) > 0) {
        await this.redis.client.incr(LEADERBOARD_VERSION_KEY).catch(() => undefined);
      }
      report.lag = await this.publishLag();
      return report;
    } catch (err) {
      this.logger.error(`Sync run failed: ${(err as Error).message}`);
      return report;
    } finally {
      this.running = false;
    }
  }

  /** Rows are copied page by page; a page and its cursor update commit together. */
  private async syncTable(table: TableSync, ctx: SyncContext, report: SyncReport): Promise<number> {
    const batch = this.config.get('SYNC_BATCH_SIZE', { infer: true });
    const window = BigInt(this.config.get('SYNC_REPLAY_WINDOW_BLOCKS', { infer: true }));

    const row = await this.prisma.syncCursor.findUnique({ where: { name: table.name } });
    let persisted = row ? { block: row.blockNumber, log: row.logIndex } : null;
    // Re-read a window before the cursor; upserts make this harmless.
    let pos = {
      block: persisted && persisted.block > window ? persisted.block - window : 0n,
      log: -1,
    };
    let copied = 0;

    for (;;) {
      const rows = await this.fetchPage(table, pos, batch);
      if (rows.length === 0) break;
      const last = rows[rows.length - 1]!;
      const lastPos = { block: BigInt(last.block_height), log: last.log_index };

      try {
        await this.prisma.$transaction(
          async (tx) => {
            await table.apply(tx, rows, ctx);
            // The cursor never moves backwards, even when this page only re-read the replay window.
            if (!persisted || isAfter(lastPos, persisted)) {
              await tx.syncCursor.upsert({
                where: { name: table.name },
                create: { name: table.name, blockNumber: lastPos.block, logIndex: lastPos.log },
                update: { blockNumber: lastPos.block, logIndex: lastPos.log },
              });
            }
          },
          { timeout: 30_000 },
        );
      } catch (err) {
        if (err instanceof DependencyMissing) {
          this.logger.warn(`${table.name}: waiting for ${err.message}`);
          report.stalled.push(table.name);
          break;
        }
        throw err;
      }

      copied += rows.length;
      if (!persisted || isAfter(lastPos, persisted)) persisted = lastPos;
      pos = lastPos;
      if (rows.length < batch) break;
    }
    return copied;
  }

  private fetchPage(
    table: TableSync,
    pos: { block: bigint; log: number },
    limit: number,
  ): Promise<RowPosition[]> {
    return this.prisma.$queryRawUnsafe<RowPosition[]>(
      `SELECT ${table.select} FROM "${this.schema}"."${table.name}"
       WHERE (block_height, log_index) > ($1::bigint, $2::int)
       ORDER BY block_height, log_index
       LIMIT $3`,
      pos.block.toString(),
      pos.log,
      limit,
    );
  }

  private context(): SyncContext {
    return {
      warn: (message) => this.logger.warn(message),
      indexerHas: async (table, id) => {
        const rows = await this.prisma.$queryRawUnsafe<unknown[]>(
          `SELECT 1 FROM "${this.schema}"."${table}" WHERE id = $1::bigint LIMIT 1`,
          id,
        );
        return rows.length > 0;
      },
    };
  }

  /**
   * Lag = the final head the indexer last saw minus its cursor, both from `chain.indexer_cursor`. Unknown (no
   * key) until the indexer has written both.
   */
  async publishLag(): Promise<bigint | null> {
    const lag = await this.readLag();
    if (lag === null) return null;
    await this.redis.client.set(INDEXER_LAG_KEY, lag.toString(), 'EX', 120).catch((err: Error) => {
      this.logger.warn(`Could not publish indexer lag: ${err.message}`);
    });
    return lag;
  }

  /** `final_head − main` from the indexer's cursor table, or null when either row is missing. */
  async readLag(): Promise<bigint | null> {
    const rows = await this.prisma.$queryRawUnsafe<{ name: string; block_height: string }[]>(
      `SELECT name, block_height::text FROM "${this.schema}"."indexer_cursor" WHERE name IN ('main', 'final_head')`,
    );
    const at = (name: string) => rows.find((r) => r.name === name)?.block_height;
    const main = at('main');
    const head = at('final_head');
    if (main === undefined || head === undefined) return null;
    const lag = BigInt(head) - BigInt(main);
    return lag > 0n ? lag : 0n;
  }

  /**
   * Compares row counts of the tables that only mirror the indexer. Differences are logged, never repaired
   * automatically: a rebuild is an explicit operator action.
   */
  async checkConsistency(): Promise<ConsistencyMismatch[]> {
    const pairs = [
      { table: 'fighter_score', api: () => this.prisma.fighterSeasonScore.count() },
      { table: 'vault_event', api: () => this.prisma.deposit.count() },
      { table: 'harvest', api: () => this.prisma.harvest.count() },
      { table: 'pick', api: () => this.prisma.pick.count() },
      { table: 'claim', api: () => this.prisma.claim.count() },
      { table: 'character_equip_event', api: () => this.prisma.characterEquipEvent.count() },
      { table: 'character_purchase', api: () => this.prisma.characterPurchase.count() },
    ];

    const mismatches: ConsistencyMismatch[] = [];
    for (const { table, api } of pairs) {
      const [row] = await this.prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "${this.schema}"."${table}"`,
      );
      const apiCount = await api();
      if (row && row.n !== apiCount) {
        mismatches.push({ table, indexer: row.n, api: apiCount });
        this.logger.warn(
          `Consistency: ${table} has ${row.n} rows in the indexer and ${apiCount} in the API`,
        );
      }
    }
    return mismatches;
  }

  /**
   * Empties the tables that only mirror the indexer and resets every cursor, so the next runs replay from
   * block zero. Duels, seasons, fighters and backers are upserted in place, which keeps `bot_config`,
   * `bots`, `bot_seeds` and `season_results` untouched.
   */
  async rebuild(): Promise<void> {
    // Children first: positions reference duels, scores/picks/claims reference seasons.
    await this.prisma.$transaction([
      this.prisma.harvest.deleteMany(),
      this.prisma.position.deleteMany(),
      this.prisma.duelTx.deleteMany(),
      this.prisma.fighterSeasonScore.deleteMany(),
      this.prisma.deposit.deleteMany(),
      this.prisma.pick.deleteMany(),
      this.prisma.claim.deleteMany(),
      this.prisma.character.deleteMany(),
      this.prisma.characterBalance.deleteMany(),
      this.prisma.characterEquip.deleteMany(),
      this.prisma.characterEquipEvent.deleteMany(),
      this.prisma.characterPurchase.deleteMany(),
      this.prisma.syncCursor.deleteMany(),
    ]);
    await this.redis.client.del(INDEXER_LAG_KEY).catch(() => undefined);
    this.logger.log('Sync cursors reset, mirrored tables emptied');
  }
}

const isAfter = (a: { block: bigint; log: number }, b: { block: bigint; log: number }) =>
  a.block > b.block || (a.block === b.block && a.log > b.log);

function isMissingRelation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /does not exist|42P01|relation .* does not exist/i.test(message);
}
