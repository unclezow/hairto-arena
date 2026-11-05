import { DuelStatus } from '../generated/prisma/enums.js';
import type { ArenaClient } from '../near/arena.client.js';
import { ChainDuelOverlay, type OverlayView } from './chain-overlay.service.js';
import type { DuelRow } from './duel-view.service.js';

const view = (status: DuelStatus): OverlayView => ({
  status,
  winner: null,
  ko: false,
  hp: { fighter: 1000, bot: 1000 },
  pointsAwarded: 0,
  counted: true,
});
const row = (status: DuelStatus) => ({ id: 10n, status, pointsAwarded: 0 }) as DuelRow;

function overlay(getDuel: () => Promise<unknown>) {
  return new ChainDuelOverlay({ getDuel: vi.fn(getDuel) } as unknown as ArenaClient);
}

describe('ChainDuelOverlay', () => {
  it('leaves an indexed terminal duel alone', async () => {
    const o = overlay(async () => {
      throw new Error('must not be called');
    });
    await expect(
      o.apply(row(DuelStatus.FINISHED), view(DuelStatus.FINISHED)),
    ).resolves.toMatchObject({
      status: DuelStatus.FINISHED,
      statusFromChain: false,
    });
  });

  it('shows a settle the indexer has not reached yet', async () => {
    const o = overlay(async () => ({
      status: 'Finished',
      winner: 'fighter.testnet',
      ko: true,
      hp_fighter: 820,
      hp_bot: 0,
    }));
    await expect(o.apply(row(DuelStatus.ACTIVE), view(DuelStatus.ACTIVE))).resolves.toMatchObject({
      status: DuelStatus.FINISHED,
      winner: 'fighter.testnet',
      ko: true,
      hp: { fighter: 820, bot: 0 },
      pointsFromChain: false,
      statusFromChain: true,
    });
  });

  it('keeps the row while the duel still runs, is gone, or the RPC fails', async () => {
    for (const read of [
      async () => ({ status: 'Active', winner: null, ko: false, hp_fighter: 1, hp_bot: 1 }),
      async () => null,
      async () => {
        throw new Error('rpc down');
      },
    ]) {
      await expect(
        overlay(read).apply(row(DuelStatus.ACTIVE), view(DuelStatus.ACTIVE)),
      ).resolves.toMatchObject({ status: DuelStatus.ACTIVE, statusFromChain: false });
    }
  });
});
