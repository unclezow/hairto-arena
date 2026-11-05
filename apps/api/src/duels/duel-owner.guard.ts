import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard.js';
import { badRequest, forbidden, notFound } from '../common/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class DuelOwnerGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const id = request.params.id;
    if (typeof id !== 'string' || !/^\d{1,30}$/.test(id)) throw badRequest('Invalid duel id');
    const duel = await this.prisma.duel.findUnique({
      where: { id: BigInt(id) },
      select: { fighterAddress: true },
    });
    if (!duel) throw notFound('Duel not found');
    if (duel.fighterAddress !== request.user.accountId) {
      throw forbidden('Only the fighter who played this duel may access it');
    }
    return true;
  }
}
