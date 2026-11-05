import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BotLevel } from '@hairto-arena/shared';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { decryptSeed, encryptSeed } from './seed-crypto.js';
import type { Seed } from './seed.js';

/** Only used outside production, where the env var is optional. */
const DEV_KEY = Buffer.alloc(32, 0x11);

export interface PendingTicketInput {
  /** Base64. */
  seedHash: string;
  seed: Seed;
  fighter: string;
  botLevel: BotLevel;
  botAccount: string;
  assetId: number;
  nonce: number;
  deadlineMs: number;
}

/** Unrevealed seeds live here, always encrypted. A plain seed only appears once it is public. */
@Injectable()
export class BotSeedStore {
  private readonly logger = new Logger(BotSeedStore.name);
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    const configured = config.get('BOT_SEED_ENCRYPTION_KEY', { infer: true });
    if (configured) {
      this.key = Buffer.from(configured.replace(/^0x/, ''), 'hex');
    } else {
      this.logger.warn('BOT_SEED_ENCRYPTION_KEY is not set, using the insecure development key');
      this.key = DEV_KEY;
    }
  }

  encrypt(seed: Seed): string {
    return encryptSeed(seed, this.key);
  }

  decrypt(stored: string): Seed {
    return decryptSeed(stored, this.key);
  }

  /** Written before the signed ticket is handed out, so a crash afterwards cannot lose the seed. */
  async savePending(input: PendingTicketInput) {
    await this.prisma.pendingTicket.create({
      data: {
        seedHash: input.seedHash,
        encryptedSeed: this.encrypt(input.seed),
        fighterAddress: input.fighter,
        botLevel: input.botLevel,
        botAddress: input.botAccount,
        assetId: input.assetId,
        nonce: BigInt(input.nonce),
        deadlineAt: new Date(input.deadlineMs),
      },
    });
  }

  findPending(seedHash: string) {
    return this.prisma.pendingTicket.findUnique({ where: { seedHash } });
  }

  deletePending(seedHash: string) {
    return this.prisma.pendingTicket.deleteMany({ where: { seedHash } });
  }

  /** Every ticket still waiting for its duel, oldest first (re-watched after a restart). */
  listPending() {
    return this.prisma.pendingTicket.findMany({ orderBy: { createdAt: 'asc' } });
  }

  /** The seed of a duel, decrypted. Null when the duel has no seed row. */
  async loadSeed(duelId: bigint): Promise<Seed | null> {
    const row = await this.prisma.botSeed.findUnique({ where: { duelId } });
    return row?.seed ? this.decrypt(row.seed) : null;
  }
}
