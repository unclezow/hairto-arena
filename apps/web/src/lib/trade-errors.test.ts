import { describe, expect, it } from 'vitest';
import { reasonOf } from './trade-errors';

describe('trade failure reasons', () => {
  it.each([
    ['Smart contract panicked: hold too short', 'HOLD 3s FIRST'],
    ['Smart contract panicked: price stale', 'PRICE FEED STALE'],
    ['Smart contract panicked: round not open', 'ROUND NOT OPEN'],
    ['Smart contract panicked: reveal window closed', 'REVEAL WINDOW CLOSED'],
    ['Smart contract panicked: trade limit reached', 'NO TRADES LEFT'],
    ['InvalidAccessKeyError: NotEnoughAllowance', 'QUICK PLAY OUT OF GAS ALLOWANCE'],
    ['User rejected the request', 'REJECTED IN WALLET'],
    ['Request timed out', 'NOT CONFIRMED YET'],
    ['something else', 'TRANSACTION FAILED'],
  ])('%s → %s', (message, reason) => {
    expect(reasonOf(new Error(message))).toBe(reason);
  });
});
