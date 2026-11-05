import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGuard } from '../auth/auth.guard.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { DuelOwnerGuard } from './duel-owner.guard.js';
import { DuelsController } from './duels.controller.js';

const FIGHTER = 'fighter.testnet';
const STRANGER = 'stranger.testnet';

describe('Duel access', () => {
  const findUnique = vi.fn();
  const guard = new DuelOwnerGuard({ duel: { findUnique } } as unknown as PrismaService);
  const context = (id: string, accountId = FIGHTER) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ params: { id }, user: { accountId } }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    findUnique.mockReset().mockResolvedValue({ fighterAddress: FIGHTER });
  });

  it('authenticates every duel route before checking ownership', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, DuelsController)).toContain(AuthGuard);
    for (const method of ['get', 'onchain', 'replay'] as const) {
      expect(Reflect.getMetadata(GUARDS_METADATA, DuelsController.prototype[method])).toContain(
        DuelOwnerGuard,
      );
    }
  });

  it('allows the owner', async () => {
    await expect(guard.canActivate(context('7', FIGHTER))).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 7n },
      select: { fighterAddress: true },
    });
  });

  it('rejects another wallet before loading any result or cached replay', async () => {
    await expect(guard.canActivate(context('7', STRANGER))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('returns not found for a missing duel', async () => {
    findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(context('7'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each(['abc', '-1', '1.5', '1'.repeat(31)])(
    'rejects invalid id %s without querying the database',
    async (id) => {
      await expect(guard.canActivate(context(id))).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(findUnique).not.toHaveBeenCalled();
    },
  );
});
