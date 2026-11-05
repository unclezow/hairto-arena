import { forbidden } from '../common/errors.js';
import { DuelsService } from './duels.service.js';

function setup(over: { enabled?: boolean; eligible?: boolean; locked?: boolean } = {}) {
  const requestTicket = vi.fn(async () => ({
    ticket: { fighter: 'fighter.testnet', nonce: 0 },
    signature: 'c2ln',
    deadlineMs: 1,
  }));
  const del = vi.fn(async () => 1);
  const service = new DuelsService(
    {} as never,
    { client: { set: async () => (over.locked ? null : 'OK'), del } } as never,
    { contractId: 'arena.hairto.testnet' } as never,
    { get: async () => over.enabled ?? true } as never,
    {
      check: async () => {
        if (over.eligible === false) throw forbidden('below minimum', 'NOT_ELIGIBLE');
        return { counted: true, remainingCounted: null };
      },
    } as never,
    { requestTicket } as never,
    {} as never,
    {} as never,
  );
  return { service, requestTicket, del };
}

const body = { assetId: 2, botLevel: 1 };

describe('DuelsService.requestTicket', () => {
  it('returns the signed ticket with the arena to send it to', async () => {
    const s = setup();
    await expect(s.service.requestTicket('fighter.testnet', body)).resolves.toMatchObject({
      arenaId: 'arena.hairto.testnet',
      signature: 'c2ln',
      counted: true,
    });
    expect(s.requestTicket).toHaveBeenCalledWith({ fighter: 'fighter.testnet', ...body });
    expect(s.del).toHaveBeenCalled();
  });

  it('never asks the worker, so no seed is stored, when the Fighter is not eligible', async () => {
    const s = setup({ eligible: false });
    await expect(s.service.requestTicket('fighter.testnet', body)).rejects.toMatchObject({
      code: 'NOT_ELIGIBLE',
    });
    expect(s.requestTicket).not.toHaveBeenCalled();
    expect(s.del).toHaveBeenCalled();
  });

  it('refuses while duels are paused or another ticket is being prepared', async () => {
    await expect(
      setup({ enabled: false }).service.requestTicket('f.testnet', body),
    ).rejects.toMatchObject({
      code: 'DUELS_DISABLED',
    });
    await expect(
      setup({ locked: true }).service.requestTicket('f.testnet', body),
    ).rejects.toMatchObject({
      code: 'DUEL_IN_PROGRESS',
    });
  });
});
