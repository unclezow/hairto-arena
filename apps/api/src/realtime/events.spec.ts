import { WS_EVENTS } from '@hairto-arena/shared';
import { describe, expect, it } from 'vitest';
import { sanitizeEvent } from './events.js';

const base = { duelId: '7', seq: 3, provisional: true };
const opened = {
  ...base,
  player: 'rookie.bots.hairto.testnet',
  isBot: true,
  state: 'opened',
  tick: 12,
};

function clean(event: string, data: unknown) {
  const result = sanitizeEvent(event, data);
  if (!result.ok) throw new Error(`rejected: ${result.reason}`);
  return result;
}

describe('sanitizeEvent', () => {
  it('passes a tick through unchanged', () => {
    const tick = { assetId: 2, tickIndex: 9, price: '101.5', publishMs: 1_800_000_000_000 };
    expect(clean(WS_EVENTS.tick, tick)).toEqual({ ok: true, data: tick, dropped: [] });
  });

  it('removes fields that are not on the allowlist and says which', () => {
    const result = clean(WS_EVENTS.tick, {
      assetId: 2,
      tickIndex: 9,
      price: '1',
      publishMs: 1,
      internalNote: 'x',
    });
    expect(result.data).not.toHaveProperty('internalNote');
    expect(result.dropped).toEqual(['internalNote']);
  });

  describe('a position that is only opened', () => {
    it('never carries a direction, PnL or HP deltas, even if the publisher sent them', () => {
      const result = clean(WS_EVENTS.duelPosition, {
        ...opened,
        dir: 1,
        pnlPpm: 400,
        selfDelta: 0,
        opponentDelta: -40,
        penalized: false,
      });
      expect(result.data).toEqual(opened);
      expect(result.data).not.toHaveProperty('dir');
      expect(result.dropped).toEqual(
        expect.arrayContaining(['dir', 'pnlPpm', 'selfDelta', 'opponentDelta', 'penalized']),
      );
    });

    it('shows the direction once the position is closed', () => {
      const closed = {
        ...base,
        player: 'rookie.bots.hairto.testnet',
        isBot: true,
        state: 'closed',
        tick: 12,
        dir: 2,
        pnlPpm: -300,
        selfDelta: -30,
        opponentDelta: 0,
        penalized: false,
      };
      expect(clean(WS_EVENTS.duelPosition, closed).data).toEqual(closed);
    });

    it('shows a penalized position with its result and no direction', () => {
      const penalized = {
        ...base,
        player: 'rookie.bots.hairto.testnet',
        isBot: true,
        state: 'closed',
        tick: 12,
        dir: null,
        pnlPpm: -300,
        selfDelta: -30,
        opponentDelta: 0,
        penalized: true,
      };
      expect(clean(WS_EVENTS.duelPosition, penalized).data).toEqual(penalized);
    });
  });

  describe('the bot seed', () => {
    it('is stripped from every event except the ones that announce the reveal', () => {
      const seed = Buffer.alloc(32, 0xab).toString('base64');
      expect(clean(WS_EVENTS.duelPosition, { ...opened, seed }).data).not.toHaveProperty('seed');
      expect(
        clean(WS_EVENTS.hpUpdate, { ...base, hpFighter: 1, hpBot: 1, seed }).data,
      ).not.toHaveProperty('seed');
      expect(
        clean(WS_EVENTS.duelStarted, {
          ...base,
          fighter: 'fighter.testnet',
          botLevel: 2,
          assetId: 1,
          startMs: 1,
          fighterCharacter: 0,
          botCharacter: 4,
          seed,
        }).data,
      ).not.toHaveProperty('seed');
      expect(clean(WS_EVENTS.duelSeed, { ...base, seed }).data).toHaveProperty('seed', seed);
      expect(
        clean(WS_EVENTS.duelResult, { ...base, winner: null, ko: false, botSeed: seed }).data,
      ).toHaveProperty('botSeed', seed);
    });
  });

  it('applies the same rules inside a snapshot', () => {
    const snapshot = {
      duelId: '7',
      seq: 3,
      status: 'active',
      fighter: 'rookie.bots.hairto.testnet',
      botLevel: 2,
      assetId: 1,
      startMs: 1,
      hp: { fighter: 1000, bot: 940 },
      positions: [
        {
          player: 'rookie.bots.hairto.testnet',
          isBot: false,
          state: 'closed',
          tick: 1,
          dir: 1,
          pnlPpm: 600,
          selfDelta: 0,
          opponentDelta: -60,
        },
        {
          player: 'fighter.testnet',
          isBot: true,
          state: 'opened',
          tick: 2,
          dir: 2,
          pnlPpm: 100,
          selfDelta: 0,
          opponentDelta: -10,
        },
      ],
      ticks: [{ tickIndex: 1, price: '1', publishMs: 1 }],
      winner: null,
      ko: false,
    };
    const result = clean(WS_EVENTS.duelSnapshot, snapshot);
    const [closed, open] = (result.data as { positions: Record<string, unknown>[] }).positions;
    expect(closed).toMatchObject({ dir: 1, pnlPpm: 600, opponentDelta: -60 });
    expect(open).not.toHaveProperty('dir');
    expect(open).not.toHaveProperty('pnlPpm');
  });

  it('rejects an event it does not know', () => {
    expect(sanitizeEvent('admin:dump', { anything: 1 })).toEqual({
      ok: false,
      reason: 'unknown-event',
    });
  });

  it.each([
    [WS_EVENTS.tick, { assetId: 'two' }],
    [WS_EVENTS.duelPosition, { ...opened, state: 'sideways' }],
    [WS_EVENTS.duelPosition, { player: 'rookie.bots.hairto.testnet' }],
    [WS_EVENTS.duelSeed, null],
  ])('rejects a malformed %s', (event, data) => {
    expect(sanitizeEvent(event, data)).toEqual({ ok: false, reason: 'malformed' });
  });
});
