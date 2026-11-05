import { describe, expect, it } from 'vitest';
import { eventsOf, findEvent, txHashOf } from './outcome';

const log = (event: string, data: unknown) =>
  `EVENT_JSON:${JSON.stringify({ standard: 'hairto', version: '1.0.0', event, data })}`;

const outcome = (receipts: { executor_id: string; logs: string[] }[]) => ({
  transaction: { hash: 'Hash111' },
  receipts_outcome: receipts.map((outcome) => ({ outcome })),
});

describe('outcome events', () => {
  it('reads duel_created from the arena callback receipt', () => {
    const o = outcome([
      { executor_id: 'arena.testnet', logs: [] },
      { executor_id: 'vault.testnet', logs: [log('duel_created', [{ duel_id: 9 }])] },
      { executor_id: 'arena.testnet', logs: ['plain text', log('duel_created', [{ duel_id: 42, start_ms: 1000 }])] },
    ]);
    const created = findEvent(eventsOf(o, 'arena.testnet'), 'duel_created');
    expect(created?.duel_id).toBe(42);
    expect(created?.start_ms).toBe(1000);
  });

  it('reads duel_rejected with its reason', () => {
    const o = outcome([
      { executor_id: 'arena.testnet', logs: [log('duel_rejected', [{ fighter: 'a.testnet', nonce: 1, reason: 'not_eligible' }])] },
    ]);
    expect(findEvent(eventsOf(o, 'arena.testnet'), 'duel_rejected')?.reason).toBe('not_eligible');
    expect(findEvent(eventsOf(o, 'arena.testnet'), 'duel_created')).toBeNull();
  });

  it('ignores other standards and malformed outcomes', () => {
    const o = outcome([
      { executor_id: 'arena.testnet', logs: [`EVENT_JSON:${JSON.stringify({ standard: 'nep245', version: '1.0.0', event: 'mt_mint', data: [] })}`] },
    ]);
    expect(eventsOf(o, 'arena.testnet')).toEqual([]);
    expect(eventsOf(null, 'arena.testnet')).toEqual([]);
  });

  it('finds the transaction hash', () => {
    expect(txHashOf({ transaction: { hash: 'abc' } })).toBe('abc');
    expect(txHashOf({ transaction_outcome: { id: 'def' } })).toBe('def');
    expect(txHashOf(undefined)).toBeNull();
  });
});
