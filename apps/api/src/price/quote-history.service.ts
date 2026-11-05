import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';
import { ORACLE_KEYS } from './oracle-keys.js';

export interface QuotePoint {
  price: string;
  /** Unix ms. */
  publishMs: number;
}

/** Recent display quotes of a market from its capped stream, oldest first. */
@Injectable()
export class QuoteHistoryService {
  constructor(private readonly redis: RedisService) {}

  async recent(assetId: number, limit: number): Promise<QuotePoint[]> {
    const entries = await this.redis.client.xrevrange(
      ORACLE_KEYS.quoteStream(assetId),
      '+',
      '-',
      'COUNT',
      limit,
    );
    return entries.reverse().map(([, fields]) => {
      const value = (name: string) => fields[fields.indexOf(name) + 1]!;
      return { price: value('price'), publishMs: Number(value('publishMs')) };
    });
  }
}
