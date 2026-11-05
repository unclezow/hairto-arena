import { describe, expect, it } from 'vitest';
import { clockOffsetMs, toLocalSec } from './chain-clock';

describe('chain clock', () => {
  it('measures the chain minus local offset', () => {
    expect(clockOffsetMs('2026-11-05T00:00:02.000Z', Date.parse('2026-11-05T00:00:00.000Z'))).toBe(2000);
  });
  it('falls back to zero for a bad timestamp', () => {
    expect(clockOffsetMs('not a date', 1)).toBe(0);
  });
  it('moves a chain time to the local clock', () => {
    expect(toLocalSec(100, 2000)).toBe(98);
  });
});
