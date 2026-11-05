import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { MarketsController, PriceHistoryController } from './markets.controller.js';
import { QuoteHistoryService } from './quote-history.service.js';
import { RedisService } from '../redis/redis.service.js';
import { MarketStatusService } from './market-status.service.js';
import { type OracleState } from './oracle-keys.js';

export interface OracleStatusEntry extends OracleState {
  assetId: number;
}

/** Read side of the oracle state, usable from the API process (the pusher runs in the worker). */
@Injectable()
export class OracleStatusService {
  constructor(private readonly redis: RedisService) {}

  async snapshot(): Promise<OracleStatusEntry[]> {
    const keys = await this.scan('oracle:state:*');
    if (keys.length === 0) return [];
    const values = await this.redis.client.mget(keys);
    return keys
      .map((key, i) => ({ key, raw: values[i] }))
      .filter((v): v is { key: string; raw: string } => v.raw !== null)
      .map(({ key, raw }) => ({
        assetId: Number(key.split(':').at(-1)),
        ...(JSON.parse(raw) as OracleState),
      }))
      .sort((a, b) => a.assetId - b.assetId);
  }

  private async scan(match: string): Promise<string[]> {
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.client.scan(cursor, 'MATCH', match, 'COUNT', 100);
      cursor = next;
      found.push(...keys);
    } while (cursor !== '0');
    return found;
  }
}

@Controller('oracle')
export class OracleController {
  constructor(private readonly status: OracleStatusService) {}

  /** Per active asset: verdict, latest tick index and how old that tick is. */
  @Get('status')
  async get() {
    const entries = await this.status.snapshot();
    return {
      items: entries.map((e) => ({
        assetId: e.assetId,
        status: e.status,
        lastTickIndex: e.lastTickIndex,
        lastPublishMs: e.lastPublishMs,
        ageMs: Math.max(0, e.evaluatedAt - e.lastPublishMs),
      })),
    };
  }
}

@Module({
  controllers: [OracleController, MarketsController, PriceHistoryController],
  providers: [OracleStatusService, MarketStatusService, QuoteHistoryService],
  exports: [OracleStatusService, MarketStatusService],
})
export class PriceStatusModule {}
