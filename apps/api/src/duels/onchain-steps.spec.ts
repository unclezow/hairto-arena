import { describe, expect, it } from 'vitest';
import { stepOf } from './onchain-steps.js';

const BOT = 'trend.bots.hairto.testnet';
const where = { block: 10n, logIndex: 3, txHash: '9ZD8dx4hVQq7SSEbvMw3Fgo6tU9ALBuNoXTzVGqAyLhP' };

describe('stepOf', () => {
  it('names the side by the bot account', () => {
    const step = stepOf(
      {
        ...where,
        kind: 'positionOpened',
        id: 1n,
        player: BOT,
        tick: 5,
      },
      BOT,
    );
    expect(step).toMatchObject({
      kind: 'opened',
      side: 'bot',
      txHash: where.txHash,
      block: 10,
      logIndex: 3,
    });
  });

  it('carries direction and damage on a close', () => {
    const step = stepOf(
      {
        ...where,
        kind: 'positionClosed',
        id: 1n,
        player: 'fighter.testnet',
        dir: 2,
        pnlPpm: 24,
        selfDelta: 0,
        opponentDelta: -96,
      },
      BOT,
    );
    expect(step).toMatchObject({ side: 'fighter', dir: 'SHORT', pnlPpm: 24, opponentDelta: -96 });
  });
});
