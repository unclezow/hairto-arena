import { toDecimalString } from './decimal.js';

describe('toDecimalString', () => {
  it.each([
    [12345678901n, -8, '123.45678901'],
    [10_000_000_000n, -8, '100'],
    [1n, -8, '0.00000001'],
    [5n, 0, '5'],
    [5n, 3, '5000'],
    [-250n, -2, '-2.5'],
    [0n, -8, '0'],
  ] as const)('%s with expo %i is %s', (price, expo, expected) => {
    expect(toDecimalString(price, expo)).toBe(expected);
  });
});
