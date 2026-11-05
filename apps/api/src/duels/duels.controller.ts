import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Authenticated, CurrentUser } from '../auth/auth.guard.js';
import type { SessionWithToken } from '../auth/session.service.js';
import { paginationQuerySchema } from '../common/pagination.js';
import { badRequest } from '../common/errors.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { z } from 'zod';
import { DuelsService } from './duels.service.js';
import { ReplayService } from './replay.service.js';
import { DuelOwnerGuard } from './duel-owner.guard.js';

const ticketSchema = z.object({
  assetId: z.number().int().positive(),
  botLevel: z.number().int().min(1).max(4),
});

function duelId(raw: string): bigint {
  if (!/^\d{1,30}$/.test(raw))
    throw badRequest('Invalid duel id', [{ path: 'id', message: 'must be a number' }]);
  return BigInt(raw);
}

@Controller('duels')
@Authenticated()
export class DuelsController {
  constructor(
    private readonly duels: DuelsService,
    private readonly replays: ReplayService,
  ) {}

  /**
   * A seed ticket for the signed-in Fighter. The Fighter starts the duel itself with `arena.start_duel(ticket,
   * signature)`; the bot worker sees the duel appear and plays it.
   */
  @Post('ticket')
  @HttpCode(201)
  @RateLimit('duel')
  async ticket(
    @CurrentUser() user: SessionWithToken,
    @Body(new ZodValidationPipe(ticketSchema)) body: z.infer<typeof ticketSchema>,
  ) {
    return this.duels.requestTicket(user.accountId, body);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(DuelOwnerGuard)
  get(@Param('id') id: string) {
    return this.duels.get(duelId(id));
  }

  /** Each on-chain step of the duel (create, open, close, settle, seed) with its transaction hash. */
  @Get(':id/onchain')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(DuelOwnerGuard)
  onchain(@Param('id') id: string) {
    return this.duels.onchain(duelId(id));
  }

  /** Tick series, revealed positions and the revealed bot seed, once the duel is over. */
  @Get(':id/replay')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(DuelOwnerGuard)
  replay(@Param('id') id: string) {
    return this.replays.get(duelId(id));
  }
}

@Controller('me/duels')
export class MyDuelsController {
  constructor(private readonly duels: DuelsService) {}

  @Get()
  @Authenticated()
  @Header('Cache-Control', 'private, no-store')
  list(
    @CurrentUser() user: SessionWithToken,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: { limit: number; cursor?: string },
  ) {
    return this.duels.listFor(user.accountId, query.limit, query.cursor);
  }
}
