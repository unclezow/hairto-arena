import { Injectable } from '@nestjs/common';
import { Dir, type BotLevel } from '@hairto-arena/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { reproduceBotTrades, type ReplayedTrade } from './bot-brain.js';
import type { BotConfigSnapshot } from './duel-recorder.js';
import { isEncryptedSeed } from './seed-crypto.js';
import { normalizeSeed } from './seed.js';

export interface AuditResult {
  status: 'match' | 'mismatch' | 'not-revealed' | 'not-found';
  reason?: string;
  expected?: ReplayedTrade[];
  actual?: { dir: Dir | null; openTick: number | null }[];
}

/** After the reveal: replay the bot's decisions from seed, snapshot and stored ticks, and compare with the chain. */
@Injectable()
export class BotAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async verify(duelId: bigint, graceSec = 5): Promise<AuditResult> {
    const duel = await this.prisma.duel.findUnique({
      where: { id: duelId },
      include: {
        bot: true,
        botSeed: true,
        positions: { where: { isBot: true }, orderBy: { openedAt: 'asc' } },
      },
    });
    if (!duel?.startAt) return { status: 'not-found' };
    // A revealed seed is stored in clear. Anything still encrypted is not public yet, and this service
    // (also used by the HTTP process) never holds the decryption key.
    if (!duel.botSeed?.revealedAt || !duel.botSeed.seed || isEncryptedSeed(duel.botSeed.seed)) {
      return { status: 'not-revealed' };
    }

    // `revealedAt` is only set after `reveal_bot_seed` succeeded, and the arena only accepts a seed whose
    // sha256(borsh((seed, fighter, nonce))) equals the ticket's seed hash.
    const seed = normalizeSeed(duel.botSeed.seed);

    const snapshot = duel.botConfig as unknown as BotConfigSnapshot;
    const startMs = duel.startAt.getTime();
    const rows = await this.prisma.tick.findMany({
      where: {
        assetId: duel.assetId,
        publishTime: {
          gte: new Date(startMs - 60_000),
          lte: new Date(startMs + (snapshot.config.roundSec + graceSec) * 1000),
        },
      },
      orderBy: { tickIndex: 'asc' },
    });
    const ticks = rows.map((r) => ({
      tickIndex: r.tickIndex,
      price: Number(r.price.toFixed()),
      publishMs: r.publishTime.getTime(),
    }));

    const expected = reproduceBotTrades(
      { level: duel.bot.level as BotLevel, config: snapshot.config, seed, startMs },
      ticks,
    );
    const actual = duel.positions.map((p) => ({
      dir: p.dir === 'LONG' ? Dir.Long : p.dir === 'SHORT' ? Dir.Short : null,
      openTick: p.openTick,
    }));

    if (expected.length !== actual.length) {
      return {
        status: 'mismatch',
        reason: `expected ${expected.length} trades, found ${actual.length}`,
        expected,
        actual,
      };
    }
    for (const [i, trade] of expected.entries()) {
      const taken = actual[i]!;
      // The arena opens at its latest tick when the transaction lands, which can trail the decision tick a little.
      const lag = (taken.openTick ?? -1) - trade.openedAtTick;
      if (taken.dir !== trade.dir || lag < 0 || lag > 3) {
        return { status: 'mismatch', reason: `trade ${i} differs`, expected, actual };
      }
    }
    return { status: 'match', expected, actual };
  }
}
