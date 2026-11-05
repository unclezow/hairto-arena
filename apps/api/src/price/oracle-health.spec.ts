import { oracleVerdict } from './oracle-health.js';

const limits = { maxStalenessMs: 5_000, voidAfterOutageMs: 10_000 };
const T = 1_800_000_000_000;

describe('oracleVerdict', () => {
  it.each([
    [2_000, 'ok'],
    [5_000, 'ok'],
    [5_001, 'stale'],
    [7_000, 'stale'],
    [10_000, 'stale'],
    [10_001, 'outage'],
    [12_000, 'outage'],
  ] as const)('a tick %i ms old is %s', (age, expected) => {
    expect(oracleVerdict(T, T + age, limits)).toBe(expected);
  });

  it('treats a tick from the future (clock skew between feed and chain) as ok', () => {
    expect(oracleVerdict(T + 10_000, T, limits)).toBe('ok');
  });
});
