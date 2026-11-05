import { createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SessionWithToken } from '../auth/session.service.js';

export type Tx = Prisma.TransactionClient;

export interface AuditContext {
  actor: SessionWithToken['accountId'];
  requestId: string | null;
}

/** The request id the logger assigned (and returned in `x-request-id`), kept with the audit record. */
export const AuditCtx = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuditContext => {
  const req = ctx.switchToHttp().getRequest<Request & { user: SessionWithToken; id?: unknown }>();
  return {
    actor: req.user.accountId,
    requestId: typeof req.id === 'string' || typeof req.id === 'number' ? String(req.id) : null,
  };
});

/** Bigints and decimals become strings, so any value can be kept as JSON. */
export function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}

/**
 * Admin changes only happen through here: the change and its audit record are one transaction, so there is never
 * a change without a record, nor a record of a change that did not happen. `AuditLog` is insert-only.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(
    ctx: AuditContext,
    action: string,
    target: string,
    change: (tx: Tx) => Promise<{ before?: unknown; after?: unknown; result: T }>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const { before, after, result } = await change(tx);
      await tx.auditLog.create({
        data: {
          actor: ctx.actor,
          action,
          target,
          before: toJson(before),
          after: toJson(after),
          requestId: ctx.requestId,
        },
      });
      return result;
    });
  }

  list(limit = 50) {
    return this.prisma.auditLog.findMany({ orderBy: { id: 'desc' }, take: limit });
  }
}
