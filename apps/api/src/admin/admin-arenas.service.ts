import { Injectable } from '@nestjs/common';
import { AppException, badRequest, notFound } from '../common/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ArenaConfig } from '../price/arena-calendar.js';
import { sessionsOverlap } from './arena-overlap.js';
import type { ArenaInput } from './caps.js';
import { AuditService, type AuditContext } from './audit.service.js';

@Injectable()
export class AdminArenasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.arena.findMany({ orderBy: { id: 'asc' } });
  }

  async create(ctx: AuditContext, input: ArenaInput) {
    await this.validate(input);
    return this.audit.run(ctx, 'arena.create', `arena:${input.name}`, async (tx) => {
      const arena = await tx.arena.create({ data: input });
      return { after: arena, result: arena };
    });
  }

  async update(ctx: AuditContext, id: number, patch: Partial<ArenaInput>) {
    const current = await this.prisma.arena.findUnique({ where: { id } });
    if (!current) throw notFound('No such arena');
    const merged: ArenaInput = {
      name: current.name,
      assetId: current.assetId,
      fallbackAssetId: current.fallbackAssetId,
      sessionStartMin: current.sessionStartMin,
      sessionEndMin: current.sessionEndMin,
      weekdayMask: current.weekdayMask,
      active: current.active,
      ...patch,
    };
    await this.validate(merged, id);
    return this.audit.run(ctx, 'arena.update', `arena:${id}`, async (tx) => {
      const arena = await tx.arena.update({ where: { id }, data: patch });
      return { before: current, after: arena, result: arena };
    });
  }

  private async validate(arena: ArenaInput, selfId?: number) {
    const problems: { path: string; message: string }[] = [];
    if ((arena.sessionStartMin === null) !== (arena.sessionEndMin === null)) {
      problems.push({ path: 'sessionStartMin', message: 'give both session times or neither' });
    }
    if (arena.fallbackAssetId === arena.assetId) {
      problems.push({ path: 'fallbackAssetId', message: 'must differ from the asset' });
    }
    const wanted = [
      arena.assetId,
      ...(arena.fallbackAssetId === null ? [] : [arena.fallbackAssetId]),
    ];
    const known = new Set(
      (await this.prisma.assetFeed.findMany({ where: { assetId: { in: wanted } } })).map(
        (a) => a.assetId,
      ),
    );
    if (!known.has(arena.assetId)) problems.push({ path: 'assetId', message: 'unknown asset' });
    if (arena.fallbackAssetId !== null && !known.has(arena.fallbackAssetId)) {
      problems.push({ path: 'fallbackAssetId', message: 'unknown asset' });
    }
    if (problems.length) throw badRequest('Invalid arena', problems);

    if (!arena.active) return;
    const others = await this.prisma.arena.findMany({
      where: {
        assetId: arena.assetId,
        active: true,
        ...(selfId === undefined ? {} : { id: { not: selfId } }),
      },
    });
    const mine: ArenaConfig = { id: selfId ?? 0, ...arena };
    const clash = others.find((o) => sessionsOverlap(mine, o as ArenaConfig));
    if (clash) {
      throw new AppException(
        409,
        'ARENA_OVERLAP',
        `Overlaps the sessions of arena "${clash.name}" on the same asset`,
      );
    }
    const sameName = await this.prisma.arena.findUnique({ where: { name: arena.name } });
    if (sameName && sameName.id !== selfId)
      throw new AppException(409, 'CONFLICT', 'An arena with this name exists');
  }
}
