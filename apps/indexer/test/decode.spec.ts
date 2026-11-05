import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeBlock } from '../src/decode.js';
import type { NeardataBlock } from '../src/neardata/types.js';
import { CONTRACTS } from './fixtures.js';

const mixed = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/block-mixed.json', import.meta.url)), 'utf8'),
) as NeardataBlock;

describe('decodeBlock', () => {
  const events = decodeBlock(mixed, CONTRACTS);

  it('ignores a hairto log from an account that is not ours', () => {
    expect(events.find((e) => e.receiptId === 'RForeign')).toBeUndefined();
  });

  it('indexes nothing from a failed receipt', () => {
    expect(events.find((e) => e.receiptId === 'RFailed')).toBeUndefined();
  });

  it('keeps two events of one receipt in order with consecutive log indexes', () => {
    const close = events.filter((e) => e.receiptId === 'RClose');
    expect(close.map((e) => [e.event, e.position.logIndex])).toEqual([
      ['position_closed', 0],
      ['duel_finished', 1],
    ]);
  });

  it('accepts nep245 only from the characters contract and only version 1.0.0', () => {
    expect(events.map((e) => `${e.executor}:${e.standard}:${e.event}`)).toEqual([
      'arena.hairto.testnet:hairto:position_closed',
      'arena.hairto.testnet:hairto:duel_finished',
      'characters.hairto.testnet:nep245:mt_mint',
      'characters.hairto.testnet:hairto:character_purchased',
      'vault.hairto.testnet:hairto:duel_rejected',
    ]);
  });

  it('numbers accepted events across shards and carries block, receipt and transaction', () => {
    expect(events.map((e) => e.position.logIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(events[0]).toMatchObject({
      block: { height: 182_001_234n, timestampMs: 1_800_000_123_456n },
      receiptId: 'RClose',
      txHash: 'TxClose',
      role: 'arena',
      data: { duel_id: 7, ko: true },
    });
    expect(events[4]).toMatchObject({ txHash: null, role: 'vault' });
  });
});
