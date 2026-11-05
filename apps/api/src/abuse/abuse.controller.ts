import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly } from '../auth/auth.guard.js';
import { paginationQuerySchema } from '../common/pagination.js';
import { accountIdSchema, ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuditCtx, type AuditContext } from '../admin/audit.service.js';
import { FreshSignature } from '../admin/fresh-signature.guard.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { AbuseFlagsService } from './abuse-flags.service.js';
import { AbuseReportService } from './abuse-report.service.js';

const listQuery = paginationQuerySchema.extend({
  status: z
    .enum(['open', 'dismissed', 'confirmed'])
    .transform((v) => v.toUpperCase() as 'OPEN' | 'DISMISSED' | 'CONFIRMED')
    .optional(),
  seasonId: z.coerce.number().int().nonnegative().optional(),
  rule: z
    .enum(['easy-bot-farming', 'cap-hugging', 'winrate-outlier', 'deposit-cycling'])
    .optional(),
  fighter: accountIdSchema.optional(),
});

const reviewBody = z
  .object({
    status: z.enum(['dismissed', 'confirmed']).optional(),
    note: z.string().max(1000).optional(),
  })
  .strict()
  .refine((v) => v.status !== undefined || v.note !== undefined, 'nothing to change');

/** Review of what the anti-abuse job found. Advisory: nothing here touches scores, ranks or prizes. */
@Controller('admin/abuse')
@AdminOnly()
@RateLimit('admin')
export class AbuseController {
  constructor(
    private readonly flags: AbuseFlagsService,
    private readonly reports: AbuseReportService,
  ) {}

  @Get('flags')
  list(@Query(new ZodValidationPipe(listQuery)) query: z.infer<typeof listQuery>) {
    return this.flags.list(query);
  }

  @Patch('flags/:id')
  @FreshSignature()
  review(
    @AuditCtx() ctx: AuditContext,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(reviewBody)) body: z.infer<typeof reviewBody>,
  ) {
    return this.flags.review(ctx, id, body);
  }

  @Get('reports/:seasonId')
  report(@Param('seasonId', ParseIntPipe) seasonId: number) {
    return this.reports.get(seasonId);
  }
}
