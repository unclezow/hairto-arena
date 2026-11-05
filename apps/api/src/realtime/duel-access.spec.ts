import type { ConfigService } from '@nestjs/config';
import type { Socket } from 'socket.io';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionService } from '../auth/session.service.js';
import type { Env } from '../config/env.js';
import type { RedisService } from '../redis/redis.service.js';
import type { DuelLiveStore } from './duel-live.js';
import { RealtimeGateway } from './realtime.gateway.js';
import type { SnapshotService } from './snapshot.service.js';

const FIGHTER = 'fighter.testnet';
const STRANGER = 'stranger.testnet';

describe('Private duel rooms', () => {
  const build = vi.fn();
  const currentSeq = vi.fn();
  const gateway = new RealtimeGateway(
    {} as RedisService,
    {} as SessionService,
    { build } as unknown as SnapshotService,
    { currentSeq } as unknown as DuelLiveStore,
    { get: () => 10 } as unknown as ConfigService<Env, true>,
  );
  const socket = (accountId?: string) =>
    ({
      data: { user: accountId ? { accountId } : undefined },
      rooms: new Set(['self']),
      join: vi.fn(),
      leave: vi.fn(),
      emit: vi.fn(),
    }) as unknown as Socket;

  beforeEach(() => {
    vi.clearAllMocks();
    build.mockResolvedValue({ snapshot: { seq: 0 }, access: { fighter: FIGHTER, terminal: true } });
    currentSeq.mockResolvedValue(0);
  });

  it('rejects anonymous users without building a snapshot', async () => {
    expect(await gateway.joinDuel(socket(), '7')).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
    expect(build).not.toHaveBeenCalled();
  });

  it.each([true, false])('rejects a stranger even when terminal=%s', async (terminal) => {
    build.mockResolvedValue({ snapshot: { seq: 0 }, access: { fighter: FIGHTER, terminal } });
    const stranger = socket(STRANGER);
    expect(await gateway.joinDuel(stranger, '7')).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(stranger.join).not.toHaveBeenCalled();
    expect(stranger.emit).not.toHaveBeenCalled();
  });

  it('allows the owner to join a finished duel', async () => {
    const owner = socket(FIGHTER);
    expect(await gateway.joinDuel(owner, '7')).toEqual({ ok: true });
    expect(owner.join).toHaveBeenCalledWith('duel:7');
  });

  it('leaves the room if a refreshed snapshot belongs to a different fighter', async () => {
    currentSeq.mockResolvedValue(1);
    build
      .mockResolvedValueOnce({ snapshot: { seq: 0 }, access: { fighter: FIGHTER, terminal: true } })
      .mockResolvedValueOnce({
        snapshot: { seq: 1 },
        access: { fighter: STRANGER, terminal: true },
      });
    const owner = socket(FIGHTER);
    expect(await gateway.joinDuel(owner, '7')).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(owner.leave).toHaveBeenCalledWith('duel:7');
  });
});
