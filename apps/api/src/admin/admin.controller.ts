import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly } from '../auth/auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { SeasonsService } from '../seasons/seasons.service.js';
import { AdminArenasService } from './admin-arenas.service.js';
import { AdminBotsService } from './admin-bots.service.js';
import { AdminFlagsService } from './admin-flags.service.js';
import { AdminStatusService } from './admin-status.service.js';
import { AuditCtx, AuditService, type AuditContext } from './audit.service.js';
import {
  botPatchSchema,
  createArenaSchema,
  updateArenaSchema,
  type ArenaInput,
  type BotPatch,
} from './caps.js';
import { FreshSignature } from './fresh-signature.guard.js';
import { ParamDriftService } from './param-drift.service.js';

const flagBody = z.object({ value: z.boolean() }).strict();
const expiringQuery = z.object({
  withinDays: z.coerce.number().int().min(1).max(30).default(3),
});
const auditQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

/**
 * Operational settings, never outcomes. There is deliberately no route here that writes a duel, a position, a
 * score, a season result, a bot seed or a claim (a test checks this).
 */
@Controller('admin')
@AdminOnly()
@RateLimit('admin')
export class AdminController {
  constructor(
    private readonly arenas: AdminArenasService,
    private readonly bots: AdminBotsService,
    private readonly flags: AdminFlagsService,
    private readonly drift: ParamDriftService,
    private readonly status: AdminStatusService,
    private readonly seasons: SeasonsService,
    private readonly audit: AuditService,
  ) {}

  @Get('status')
  getStatus() {
    return this.status.get();
  }

  @Get('arenas')
  listArenas() {
    return this.arenas.list();
  }

  @Post('arenas')
  @FreshSignature()
  createArena(
    @AuditCtx() ctx: AuditContext,
    @Body(new ZodValidationPipe(createArenaSchema)) body: ArenaInput,
  ) {
    return this.arenas.create(ctx, body);
  }

  @Patch('arenas/:id')
  @FreshSignature()
  updateArena(
    @AuditCtx() ctx: AuditContext,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateArenaSchema)) body: Partial<ArenaInput>,
  ) {
    return this.arenas.update(ctx, id, body);
  }

  @Get('bots')
  listBots() {
    return this.bots.list();
  }

  @Patch('bots/:id')
  @FreshSignature()
  updateBot(
    @AuditCtx() ctx: AuditContext,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(botPatchSchema)) body: BotPatch,
  ) {
    return this.bots.update(ctx, id, body);
  }

  @Get('flags')
  listFlags() {
    return this.flags.list();
  }

  @Put('flags/:name')
  @FreshSignature()
  setFlag(
    @AuditCtx() ctx: AuditContext,
    @Param('name') name: string,
    @Body(new ZodValidationPipe(flagBody)) body: z.infer<typeof flagBody>,
  ) {
    return this.flags.set(ctx, name, body.value);
  }

  @Get('params/drift')
  paramDrift() {
    return this.drift.view();
  }

  @Get('seasons/:id/expiring-claims')
  async expiringClaims(
    @Param('id', ParseIntPipe) id: number,
    @Query(new ZodValidationPipe(expiringQuery)) query: z.infer<typeof expiringQuery>,
  ) {
    return { items: await this.seasons.expiringClaims(id, query.withinDays) };
  }

  @Get('audit')
  async auditLog(@Query(new ZodValidationPipe(auditQuery)) query: z.infer<typeof auditQuery>) {
    return { items: await this.audit.list(query.limit) };
  }
}
