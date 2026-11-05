import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { AuthGuard } from '../auth/auth.guard.js';
import type { SessionService, SessionWithToken } from '../auth/session.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { FreshnessService } from '../read-model/freshness.service.js';
import type { SeasonLookup } from '../read-model/season-lookup.service.js';
import type { WalletStatusService } from '../read-model/wallet-status.service.js';
import { FightersController } from './fighters.controller.js';
import { FightersService } from './fighters.service.js';

const FIGHTER = 'fighter.testnet';

describe('Fighter history privacy', () => {
  it('requires authentication on the account history endpoint', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, FightersController.prototype.history)).toContain(
      AuthGuard,
    );
  });

  it('rejects a different fighter before querying their history', async () => {
    const history = vi.fn();
    const controller = new FightersController(
      { history } as unknown as FightersService,
      {} as FreshnessService,
      {} as WalletStatusService,
      {} as SessionService,
    );
    await expect(
      controller.history(
        {
          accountId: 'stranger.testnet',
          token: 'test',
          role: 'user',
          signedAt: 0,
        },
        FIGHTER,
        { limit: 20 },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(history).not.toHaveBeenCalled();
  });

  it('allows the owner to read history', async () => {
    const history = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const controller = new FightersController(
      { history } as unknown as FightersService,
      { get: async () => ({}) } as FreshnessService,
      {} as WalletStatusService,
      {} as SessionService,
    );
    await expect(
      controller.history({ accountId: FIGHTER } as unknown as SessionWithToken, FIGHTER, {
        limit: 20,
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });
  });

  it('does not load or expose individual results in the public profile', async () => {
    const findMany = vi.fn();
    const service = new FightersService(
      {
        fighter: { findUnique: async () => ({ address: FIGHTER, status: 'active' }) },
        fighterSeasonScore: { findMany: async () => [] },
        duel: { findMany },
      } as unknown as PrismaService,
      { current: async () => null } as SeasonLookup,
      { get: async () => ({}) } as FreshnessService,
    );
    const profile = await service.profile(FIGHTER);
    expect(profile.recentDuels).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
