import { Injectable } from '@nestjs/common';
import { AppException, badRequest, conflict, notFound } from '../common/errors.js';
import { decodeCursor, toPage, type Page } from '../common/pagination.js';
import { RuntimeFlagsService } from '../flags/runtime-flags.service.js';
import { ArenaClient } from '../near/arena.client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { BotClient, type IssuedTicket } from './bot-client.js';
import { ChainDuelOverlay } from './chain-overlay.service.js';
import { DuelViewService, type DuelRow } from './duel-view.service.js';
import {
  EligibilityService,
  type Eligibility,
  type TicketRequestBody,
} from './eligibility.service.js';
import { onchainKey, type PlacedStep } from './onchain-steps.js';

/** One ticket request per Fighter at a time; a slow prime or worker answer cannot be raced. */
const TICKET_LOCK_SEC = 30;

export interface TicketResponse extends IssuedTicket, Eligibility {
  /** The arena the ticket is signed for: the Fighter calls `start_duel` there. */
  arenaId: string;
}

const ticketLockKey = (fighter: string) => `duel:ticket:${fighter}`;

@Injectable()
export class DuelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly arena: ArenaClient,
    private readonly flags: RuntimeFlagsService,
    private readonly eligibility: EligibilityService,
    private readonly bot: BotClient,
    private readonly views: DuelViewService,
    private readonly overlay: ChainDuelOverlay,
  ) {}

  /**
   * The Fighter asks for a seed ticket. The API checks eligibility with reason codes, then the bot worker primes
   * the price, stores the seed and signs the ticket. The Fighter sends it to `arena.start_duel` from the wallet.
   */
  async requestTicket(
    fighter: string,
    body: TicketRequestBody,
    now = new Date(),
  ): Promise<TicketResponse> {
    if (!(await this.flags.get('DUELS_ENABLED'))) {
      throw new AppException(503, 'DUELS_DISABLED', 'Duels are paused');
    }
    const lock = await this.redis.client.set(
      ticketLockKey(fighter),
      '1',
      'EX',
      TICKET_LOCK_SEC,
      'NX',
    );
    if (lock !== 'OK') {
      throw conflict('DUEL_IN_PROGRESS', 'A ticket is already being prepared for this fighter');
    }
    try {
      const eligibility = await this.eligibility.check(fighter, body, now);
      const issued = await this.bot.requestTicket({ fighter, ...body });
      return { ...issued, ...eligibility, arenaId: this.arena.contractId };
    } finally {
      await this.redis.client.del(ticketLockKey(fighter)).catch(() => undefined);
    }
  }

  async get(id: bigint) {
    const duel = await this.load(id);
    if (!duel) throw notFound('Duel not found');
    return this.overlay.apply(duel, await this.views.view(duel));
  }

  /**
   * Every on-chain step of a duel with its transaction hash, oldest first. A live event source can fill Redis
   * within seconds; the indexer's rows arrive later and win when both have the same receipt event.
   */
  async onchain(id: bigint) {
    const duel = await this.load(id);
    if (!duel) throw notFound('Duel not found');
    const bot = duel.bot.address;
    const [rows, live] = await Promise.all([
      this.prisma.duelTx.findMany({ where: { duelId: id } }),
      this.redis.client.lrange(onchainKey(id.toString()), 0, -1).catch(() => [] as string[]),
    ]);

    const steps = new Map<string, PlacedStep>();
    for (const raw of live) {
      const step = JSON.parse(raw) as PlacedStep;
      steps.set(`${step.txHash}:${step.logIndex}`, step);
    }
    for (const r of rows) {
      steps.set(`${r.txHash}:${r.logIndex}`, {
        kind: r.kind as PlacedStep['kind'],
        side: r.player === null ? null : r.player === bot ? 'bot' : 'fighter',
        txHash: r.txHash,
        at: r.timestamp.toISOString(),
        // Only a close reveals the direction, and only a close or penalty carries a result.
        dir: r.dir === 1 ? 'LONG' : r.dir === 2 ? 'SHORT' : null,
        pnlPpm: r.pnlPpm,
        selfDelta: r.selfDelta,
        opponentDelta: r.opponentDelta,
        block: Number(r.blockNumber),
        logIndex: r.logIndex,
      });
    }
    return {
      arena: this.arena.contractId,
      txs: [...steps.values()]
        .sort((a, b) => a.block - b.block || a.logIndex - b.logIndex)
        .map(({ block: _block, logIndex: _logIndex, ...step }) => step),
    };
  }

  async listFor(
    fighter: string,
    limit: number,
    cursor?: string,
  ): Promise<Page<Awaited<ReturnType<DuelViewService['view']>>>> {
    const after = cursor ? decodeCursor<{ id: string }>(cursor) : null;
    if (after && !/^\d+$/.test(after.id)) throw badRequest('Invalid cursor');

    const rows = await this.prisma.duel.findMany({
      where: { fighterAddress: fighter, ...(after ? { id: { lt: BigInt(after.id) } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: { bot: true, positions: true },
    });
    const page = toPage(rows, limit, (last) => ({ id: last.id.toString() }));
    const items = await Promise.all(page.items.map((d) => this.views.view(d)));
    return { items, nextCursor: page.nextCursor };
  }

  private load(id: bigint): Promise<DuelRow | null> {
    return this.prisma.duel.findUnique({ where: { id }, include: { bot: true, positions: true } });
  }
}
