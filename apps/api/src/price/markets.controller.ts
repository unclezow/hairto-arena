import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { badRequest, notFound } from '../common/errors.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MarketStatusService } from './market-status.service.js';
import { marketById } from './markets.js';
import { QuoteHistoryService } from './quote-history.service.js';

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(600).default(300),
});

@Controller('markets')
export class MarketsController {
  constructor(private readonly markets: MarketStatusService) {}

  /** Every market with open/closed, last display quote and the next session change. */
  @Get()
  async list() {
    return { items: await this.markets.list() };
  }
}

@Controller('prices')
export class PriceHistoryController {
  constructor(private readonly history: QuoteHistoryService) {}

  /** Recent display quotes for a chart backfill, oldest first. */
  @Get(':assetId/history')
  async get(
    @Param('assetId') raw: string,
    @Query(new ZodValidationPipe(historyQuerySchema)) query: { limit: number },
  ) {
    if (!/^\d{1,6}$/.test(raw))
      throw badRequest('Invalid asset id', [{ path: 'assetId', message: 'must be a number' }]);
    const assetId = Number(raw);
    if (!marketById(assetId)) throw notFound('Unknown market');
    return { assetId, items: await this.history.recent(assetId, query.limit) };
  }
}
