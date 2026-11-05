import { Injectable } from '@nestjs/common';
import { decodeCursor, toPage } from '../common/pagination.js';
import { notFound } from '../common/errors.js';
import { FlagStatus } from '../generated/prisma/enums.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService, type AuditContext, type Tx } from '../admin/audit.service.js';
import { AbuseConfig } from './abuse-config.js';

export interface FlagQuery {
  limit: number;
  cursor?: string;
  status?: FlagStatus;
  seasonId?: number;
  rule?: string;
  fighter?: string;
}

@Injectable()
export class AbuseFlagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AbuseConfig,
  ) {}

  async list(q: FlagQuery) {
    const after = q.cursor ? decodeCursor<{ id: number }>(q.cursor).id : undefined;
    const rows = await this.prisma.fighterFlag.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.seasonId === undefined ? {} : { seasonId: q.seasonId }),
        ...(q.rule ? { rule: q.rule } : {}),
        ...(q.fighter ? { fighterAddress: q.fighter } : {}),
        ...(after === undefined ? {} : { id: { lt: after } }),
      },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    return toPage(rows, q.limit, (last) => ({ id: last.id }));
  }

  /** Dismiss or confirm a flag and/or leave a note. The fighter's mark follows in the same transaction. */
  async review(
    ctx: AuditContext,
    id: number,
    change: { status?: 'dismissed' | 'confirmed'; note?: string },
  ) {
    const flag = await this.prisma.fighterFlag.findUnique({ where: { id } });
    if (!flag) throw notFound('No such flag');

    return this.audit.run(ctx, 'abuse.review', `flag:${id}`, async (tx) => {
      const updated = await tx.fighterFlag.update({
        where: { id },
        data: {
          ...(change.status
            ? {
                status: change.status === 'dismissed' ? FlagStatus.DISMISSED : FlagStatus.CONFIRMED,
                reviewedBy: ctx.actor,
                reviewedAt: new Date(),
              }
            : {}),
          ...(change.note === undefined ? {} : { note: change.note }),
        },
      });
      await this.syncStatus(tx, flag.fighterAddress);
      return {
        before: { status: flag.status, note: flag.note },
        after: { status: updated.status, note: updated.note },
        result: updated,
      };
    });
  }

  /**
   * The fighter is marked FLAGGED while an open or confirmed flag exists, and goes back to ACTIVE when none is
   * left. Display and review only: nothing reads this mark to decide rank, points, prizes or who may play.
   * In report only mode the mark is not touched at all.
   */
  async syncStatus(tx: Tx | PrismaService, address: string) {
    if (this.config.reportOnly) return;
    const open = await tx.fighterFlag.count({
      where: { fighterAddress: address, status: { in: [FlagStatus.OPEN, FlagStatus.CONFIRMED] } },
    });
    const fighter = await tx.fighter.findUnique({ where: { address }, select: { status: true } });
    if (!fighter) return;
    if (open > 0 && fighter.status === 'ACTIVE') {
      await tx.fighter.update({ where: { address }, data: { status: 'FLAGGED' } });
    } else if (open === 0 && fighter.status === 'FLAGGED') {
      await tx.fighter.update({ where: { address }, data: { status: 'ACTIVE' } });
    }
  }

  async openCount(): Promise<number> {
    return this.prisma.fighterFlag.count({ where: { status: FlagStatus.OPEN } });
  }
}

export type { Prisma };
