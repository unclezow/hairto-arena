import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BotLevel } from '@hairto-arena/shared';
import type { PrivateKey } from 'near-kit';
import { DuelStatus } from '../generated/prisma/enums.js';
import type { SeedTicketJson } from '../near/arena.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BotDuelRunner, type RunnerInit } from './bot-duel-runner.js';
import { BOT_GATEWAY, BotChainError, type BotGateway, type ChainDuel } from './bot-gateway.js';
import { DuelRecorder, NoActiveSeason, type BotConfigSnapshot } from './duel-recorder.js';
import { PricePrimer } from './price-primer.js';
import { RedisRunnerState } from './runner-state.js';
import { BotSeedStore } from './seed-store.js';
import { generateSeed, hashSeed } from './seed.js';
import { signTicket } from './ticket-signer.js';
import { TICK_SOURCE, type TickSource } from './tick-feed.js';

export interface TicketRequest {
  fighter: string;
  assetId: number;
  botLevel: BotLevel;
}

export interface IssuedTicket {
  ticket: SeedTicketJson;
  /** Base64 ed25519 signature for `start_duel`. */
  signature: string;
  deadlineMs: number;
}

/** What the worker needs to sign tickets: the arena id, the ticket key, and the levels that passed the boot check. */
export interface TicketSetup {
  arenaId: string;
  ticketKey: PrivateKey;
  levels: readonly BotLevel[];
}

interface PendingRow {
  seedHash: string;
  fighterAddress: string;
  botLevel: number;
  botAddress: string;
  assetId: number;
  nonce: bigint;
  deadlineAt: Date;
}

/** A ticket is valid this long; the arena allows at most 60 s. */
export const TICKET_LIFETIME_MS = 55_000;
/** The watcher keeps looking this long after the deadline (the vault answer can land a few blocks later). */
export const WATCH_AFTER_DEADLINE_MS = 10_000;
const POLL_MS = 400;
/** Recent duel ids searched for a ticket whose duel the watcher did not see (for example after a restart). */
const LOOKBACK_DUELS = 64;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Signs seed tickets for Fighters and plays the duels they start with them. The Fighter, not the bot, calls
 * `start_duel`; the worker learns the duel id by watching `active_duel_of` and checking the seed hash.
 */
@Injectable()
export class BotDuelService {
  private readonly logger = new Logger(BotDuelService.name);
  private readonly runners = new Map<bigint, BotDuelRunner>();
  private readonly watching = new Set<string>();
  private setup: TicketSetup | null = null;
  private stopped = false;
  /** Poll interval of the watcher; tests shorten it. */
  pollMs = POLL_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly seeds: BotSeedStore,
    private readonly recorder: DuelRecorder,
    private readonly runnerState: RedisRunnerState,
    @Inject(BOT_GATEWAY) private readonly gateway: BotGateway,
    @Inject(TICK_SOURCE) private readonly ticks: TickSource,
    private readonly primer: PricePrimer,
  ) {}

  get activeRunners() {
    return this.runners.size;
  }

  get watchedTickets() {
    return this.watching.size;
  }

  /** Set once the boot checks passed; until then no ticket is signed. */
  configure(setup: TicketSetup | null) {
    this.setup = setup;
  }

  /**
   * Primes the asset, then generates the seed, stores it encrypted as pending, signs the ticket and starts
   * watching for the duel. Nothing is stored when priming fails.
   */
  async issueTicket(request: TicketRequest, nowMs = Date.now()): Promise<IssuedTicket> {
    const setup = this.setup;
    if (!setup || !setup.levels.includes(request.botLevel)) {
      throw new BotChainError('BOT_UNAVAILABLE', `Bot level ${request.botLevel} is not served`);
    }
    await this.primer.prime(request.assetId);

    const seed = generateSeed();
    const nonce = await this.gateway.nonceOf(request.fighter);
    const seedHash = hashSeed(seed, request.fighter, nonce);
    const deadlineMs = nowMs + TICKET_LIFETIME_MS;
    const ticket: SeedTicketJson = {
      fighter: request.fighter,
      asset_id: request.assetId,
      bot_level: request.botLevel,
      seed_hash: seedHash,
      nonce,
      deadline_ms: deadlineMs,
    };
    await this.seeds.savePending({
      seedHash,
      seed,
      fighter: request.fighter,
      botLevel: request.botLevel,
      botAccount: this.gateway.botAccount(request.botLevel),
      assetId: request.assetId,
      nonce,
      deadlineMs,
    });
    const { signature } = signTicket(setup.ticketKey, setup.arenaId, ticket);
    void this.watch({
      seedHash,
      fighterAddress: request.fighter,
      botLevel: request.botLevel,
      botAddress: this.gateway.botAccount(request.botLevel),
      assetId: request.assetId,
      nonce: BigInt(nonce),
      deadlineAt: new Date(deadlineMs),
    });
    return { ticket, signature, deadlineMs };
  }

  /**
   * Polls the Fighter's slot until the duel of this ticket shows up, then records it and starts the runner. Gives
   * up `WATCH_AFTER_DEADLINE_MS` after the deadline, deletes the pending seed, and is safe to call twice.
   */
  async watch(pending: PendingRow): Promise<bigint | null> {
    if (this.watching.has(pending.seedHash)) return null;
    this.watching.add(pending.seedHash);
    try {
      const until = pending.deadlineAt.getTime() + WATCH_AFTER_DEADLINE_MS;
      while (!this.stopped && Date.now() <= until) {
        const duelId = await this.findActive(pending).catch((err: Error) => {
          this.logger.warn(`Watching ${pending.fighterAddress}: ${err.message}`);
          return null;
        });
        if (duelId !== null) {
          if (await this.tryAdopt(duelId, pending)) return duelId;
        }
        await sleep(this.pollMs);
      }
      if (this.stopped) return null;
      // Missed while polling (a slow RPC, a restart): look through the newest duels before giving up.
      const late = await this.findRecent(pending).catch(() => null);
      if (late !== null && (await this.tryAdopt(late, pending))) return late;
      await this.seeds.deletePending(pending.seedHash);
      this.logger.log(`Ticket of ${pending.fighterAddress} expired unused`);
      return null;
    } finally {
      this.watching.delete(pending.seedHash);
    }
  }

  /** After a restart: watch every pending ticket again (an expired one gets its final search). */
  async resumePending(): Promise<number> {
    const rows = await this.seeds.listPending();
    for (const row of rows) void this.watch(row);
    return rows.length;
  }

  private async findActive(pending: PendingRow): Promise<bigint | null> {
    const slot = await this.gateway.activeDuelOf(pending.fighterAddress);
    if (!slot || !('Active' in slot)) return null;
    const duelId = BigInt(slot.Active.duel_id);
    const duel = await this.gateway.getDuel(duelId);
    return duel?.seedHash === pending.seedHash ? duelId : null;
  }

  private async findRecent(pending: PendingRow): Promise<bigint | null> {
    const next = await this.gateway.nextDuelId();
    for (let id = next - 1; id >= Math.max(1, next - LOOKBACK_DUELS); id--) {
      const duel = await this.gateway.getDuel(BigInt(id));
      if (duel?.seedHash === pending.seedHash && duel.fighter === pending.fighterAddress) {
        return BigInt(id);
      }
    }
    return null;
  }

  /**
   * `adopt` that never throws. `watch` runs detached, so a failed RPC call here (a 429 from a busy public node, say)
   * would otherwise be an unhandled rejection and take the whole worker down. The watcher tries again instead.
   */
  private async tryAdopt(duelId: bigint, pending: PendingRow): Promise<boolean> {
    try {
      await this.adopt(duelId, pending);
      return true;
    } catch (err) {
      this.logger.warn(`Duel ${duelId} not adopted yet: ${(err as Error).message}`);
      return false;
    }
  }

  /** Records the duel with its seed and, while the round is still on, starts playing. */
  private async adopt(duelId: bigint, pending: PendingRow) {
    const duel = (await this.gateway.getDuel(duelId)) as ChainDuel;
    try {
      await this.recorder.record({
        duelId,
        level: pending.botLevel as BotLevel,
        fighter: duel.fighter,
        botAccount: pending.botAddress,
        assetId: duel.assetId,
        startMs: duel.startMs,
        seedHash: pending.seedHash,
      });
    } catch (err) {
      // The seed stays pending, so a later resume records the duel and its seed can still be revealed.
      this.logger.error(`Duel ${duelId} not recorded yet: ${(err as Error).message}`);
      return;
    }
    if (duel.status === 'Active') await this.startRunner(duelId);
    this.logger.log(`Duel ${duelId} of ${duel.fighter} recorded`);
  }

  /** Starts the runner of a recorded duel. Safe to call twice. */
  async startRunner(duelId: bigint): Promise<boolean> {
    if (this.runners.has(duelId)) return true;

    const duel = await this.prisma.duel.findUnique({
      where: { id: duelId },
      include: { bot: true },
    });
    const seed = await this.seeds.loadSeed(duelId);
    if (!duel || !seed || !duel.startAt) return false;

    const snapshot = duel.botConfig as unknown as BotConfigSnapshot;
    const init: RunnerInit = {
      duelId,
      level: duel.bot.level as BotLevel,
      assetId: duel.assetId,
      botAccount: duel.bot.address,
      seed,
      config: snapshot.config,
      startMs: duel.startAt.getTime(),
    };
    const runner = new BotDuelRunner(init, {
      gateway: this.gateway,
      ticks: this.ticks,
      state: this.runnerState,
      onDone: (id) => void this.runners.delete(id),
    });
    this.runners.set(duelId, runner);
    await runner.start();
    return true;
  }

  /** After a restart: runners for every duel that is still being played. */
  async resumeActive(): Promise<number> {
    const nowMs = Date.now();
    const duels = await this.prisma.duel.findMany({
      where: { status: { in: [DuelStatus.CREATED, DuelStatus.ACTIVE] }, startAt: { not: null } },
      include: { bot: true, botSeed: true },
    });
    let started = 0;
    for (const duel of duels) {
      const config = (duel.botConfig as unknown as BotConfigSnapshot).config;
      const over = duel.startAt!.getTime() + (config.roundSec + 5) * 1000 < nowMs;
      if (over || !duel.botSeed) continue;
      if (await this.startRunner(duel.id)) started++;
    }
    return started;
  }

  stopAll() {
    this.stopped = true;
    for (const runner of this.runners.values()) runner.stop();
    this.runners.clear();
  }
}

export { BotChainError, NoActiveSeason };
