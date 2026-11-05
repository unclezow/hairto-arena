import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface Freshness {
  /** Highest NEAR block height the sync job has copied, as a string. Null before the first sync. */
  indexedAtBlock: string | null;
  indexedAt: Date | null;
}

/** How current the read model is, so a client can tell data from a few seconds ago from data from an hour ago. */
@Injectable()
export class FreshnessService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<Freshness> {
    const { _max } = await this.prisma.syncCursor.aggregate({
      _max: { blockNumber: true, updatedAt: true },
    });
    return {
      indexedAtBlock: _max.blockNumber?.toString() ?? null,
      indexedAt: _max.updatedAt ?? null,
    };
  }
}
