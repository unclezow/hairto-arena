import { PRIZE_CURVE_BPS } from '@hairto-arena/shared';
import { describe, expect, it } from 'vitest';
import { bonusAmounts } from './bonuses.js';
import { buildTree, EMPTY_ROOT, verifyProof } from './merkle.js';
import { prizeAmounts } from './prizes.js';
import { rankFighters, type ScoreInput } from './ranking.js';
import { computeSeasonResults, hashInputs, type ResultInputs } from './results.js';
import { balanceAt, twab } from './twab.js';

const USD = 1_000_000n;
const addr = (n: number) => `fighter-${String(n).padStart(3, '0')}.testnet`;
const score = (
  n: number,
  points: number,
  wins: number,
  duels = 10,
  reachedAt: number | null = 1000,
): ScoreInput => ({
  address: addr(n),
  points,
  wins,
  duels,
  reachedAt,
});

describe('rankFighters', () => {
  it('orders by points, then wins, then who reached the score first, then address', () => {
    const ranked = rankFighters(
      [
        score(1, 50, 5, 10, 2000),
        score(2, 50, 6, 10, 3000),
        score(3, 50, 5, 10, 1000),
        score(4, 90, 1),
        score(5, 50, 5, 10, 1000),
      ],
      10,
    );
    expect(ranked.map((r) => r.address)).toEqual([addr(4), addr(2), addr(3), addr(5), addr(1)]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it('leaves out fighters with too few duels, however many points they have', () => {
    const ranked = rankFighters([score(1, 80, 8, 10), score(2, 99, 9, 9)], 10);
    expect(ranked.map((r) => r.address)).toEqual([addr(1)]);
  });

  it('puts an unknown time last among equals', () => {
    const ranked = rankFighters([score(1, 10, 1, 10, null), score(2, 10, 1, 10, 5000)], 10);
    expect(ranked.map((r) => r.address)).toEqual([addr(2), addr(1)]);
  });

  it('gives the same order whatever order the data arrives in', () => {
    const scores = [score(1, 10, 1), score(2, 10, 1), score(3, 20, 2), score(4, 10, 1, 10, 500)];
    expect(rankFighters([...scores].reverse(), 10)).toEqual(rankFighters(scores, 10));
  });
});

describe('prizeAmounts', () => {
  const ranked = (n: number) =>
    rankFighters(
      Array.from({ length: n }, (_, i) => score(i + 1, 1000 - i, 5)),
      10,
    );

  it('pays each rank its share of the pool', () => {
    const prizes = prizeAmounts(1000n * USD, PRIZE_CURVE_BPS, ranked(20));
    const amount = (rank: number) => prizes.find((p) => p.rank === rank)!.amount;
    expect(amount(1)).toBe(250n * USD);
    expect(amount(2)).toBe(170n * USD);
    expect(amount(5)).toBe(50n * USD);
    expect(amount(6)).toBe(30n * USD);
    expect(amount(10)).toBe(30n * USD);
    expect(amount(11)).toBe(15n * USD);
    expect(amount(20)).toBe(15n * USD);
  });

  it('pays the whole pool when all twenty ranks are filled', () => {
    const total = prizeAmounts(1000n * USD, PRIZE_CURVE_BPS, ranked(20)).reduce(
      (s, p) => s + p.amount,
      0n,
    );
    expect(total).toBe(1000n * USD);
  });

  it('pays nothing beyond rank 20', () => {
    expect(prizeAmounts(1000n * USD, PRIZE_CURVE_BPS, ranked(25))).toHaveLength(20);
  });

  it('leaves the shares of empty ranks unpaid instead of handing them to the others', () => {
    const prizes = prizeAmounts(1000n * USD, PRIZE_CURVE_BPS, ranked(8));
    const total = prizes.reduce((s, p) => s + p.amount, 0n);
    // Ranks 9-20 would have taken 10 percent of the pool? No: ranks 9, 10 take 3 each, 11-20 take 15: 21 percent.
    expect(total).toBe(790n * USD);
    expect(prizes.find((p) => p.rank === 1)!.amount).toBe(250n * USD);
  });

  it('floors every share', () => {
    const prizes = prizeAmounts(10n, PRIZE_CURVE_BPS, ranked(3));
    expect(prizes.map((p) => p.amount)).toEqual([2n, 1n, 1n]);
  });

  it('pays nobody when nobody qualifies', () => {
    expect(prizeAmounts(1000n * USD, PRIZE_CURVE_BPS, [])).toEqual([]);
  });
});

describe('twab', () => {
  const DAY = 86_400_000;
  const dep = (at: number, usd: number) => ({ at, delta: BigInt(usd) * USD });
  const out = (at: number, usd: number) => ({ at, delta: -BigInt(usd) * USD });

  it('is the balance when it never changed', () => {
    expect(twab([dep(0, 100)], 0, 7 * DAY)).toBe(100n * USD);
  });

  it('weights a later deposit by the time it was held', () => {
    // 100 for the first half, 300 for the second: average 200.
    expect(twab([dep(0, 100), dep(3 * DAY + DAY / 2, 200)], 0, 7 * DAY)).toBe(200n * USD);
  });

  it('counts a withdrawal', () => {
    expect(twab([dep(0, 100), out(DAY, 100)], 0, 4 * DAY)).toBe(25n * USD);
  });

  it('starts from the balance held before the window', () => {
    expect(twab([dep(-5 * DAY, 100)], 0, 7 * DAY)).toBe(100n * USD);
  });

  it('ignores events after the end', () => {
    expect(twab([dep(0, 100), dep(8 * DAY, 900)], 0, 7 * DAY)).toBe(100n * USD);
  });

  it('is zero for no events and for an empty window', () => {
    expect(twab([], 0, DAY)).toBe(0n);
    expect(twab([dep(0, 100)], DAY, DAY)).toBe(0n);
  });

  it('applies events of the same second in the order given', () => {
    const events = [dep(0, 100), dep(DAY, 50), out(DAY, 50)];
    expect(twab(events, 0, 2 * DAY)).toBe(100n * USD);
  });

  it('does not depend on the order events are listed in, apart from the same second', () => {
    const a = [dep(0, 100), dep(DAY, 200), out(2 * DAY, 100)];
    expect(twab([...a].reverse(), 0, 4 * DAY)).toBe(twab(a, 0, 4 * DAY));
  });

  it('knows the balance at a moment', () => {
    expect(balanceAt([dep(0, 100), out(DAY, 30)], DAY)).toBe(70n * USD);
    expect(balanceAt([dep(0, 100), out(DAY, 30)], DAY - 1)).toBe(100n * USD);
  });
});

describe('bonusAmounts', () => {
  const prizes = [
    { address: addr(1), rank: 1, amount: 250n * USD },
    { address: addr(2), rank: 2, amount: 170n * USD },
  ];

  it('splits the pool by the picked fighter’s share of prizes and the backer’s share of that fighter’s backers', () => {
    const bonuses = bonusAmounts({
      backerPool: 840n * USD,
      prizes,
      picks: [
        { backer: addr(90), fighter: addr(1) },
        { backer: addr(91), fighter: addr(1) },
        { backer: addr(92), fighter: addr(2) },
      ],
      twabByBacker: new Map([
        [addr(90), 100n * USD],
        [addr(91), 300n * USD],
        [addr(92), 50n * USD],
      ]),
    });
    // totalPrize 420. Fighter 1 gets 250/420 of 840 = 500, split 1:3 -> 125 and 375. Fighter 2: 170/420 -> 340.
    const of = (a: string) => bonuses.find((b) => b.address === a)!.amount;
    expect(of(addr(90))).toBe(125n * USD);
    expect(of(addr(91))).toBe(375n * USD);
    expect(of(addr(92))).toBe(340n * USD);
  });

  it('pays nothing for a fighter without a prize, and nothing to a backer who is not eligible', () => {
    const bonuses = bonusAmounts({
      backerPool: 100n * USD,
      prizes,
      picks: [
        { backer: addr(90), fighter: addr(77) },
        { backer: addr(91), fighter: addr(1) },
        { backer: addr(92), fighter: addr(1) },
      ],
      twabByBacker: new Map([
        [addr(90), 100n * USD],
        [addr(92), 100n * USD],
      ]),
    });
    expect(bonuses.map((b) => b.address)).toEqual([addr(92)]);
  });

  it('pays nothing when there are no prizes', () => {
    expect(
      bonusAmounts({
        backerPool: 100n,
        prizes: [],
        picks: [{ backer: addr(1), fighter: addr(2) }],
        twabByBacker: new Map([[addr(1), 1n]]),
      }),
    ).toEqual([]);
  });

  it('never pays out more than the pool', () => {
    const bonuses = bonusAmounts({
      backerPool: 7n,
      prizes,
      picks: [1, 2, 3].map((n) => ({ backer: addr(90 + n), fighter: addr(1) })),
      twabByBacker: new Map([1, 2, 3].map((n) => [addr(90 + n), 1n] as const)),
    });
    expect(bonuses.reduce((s, b) => s + b.amount, 0n)).toBeLessThanOrEqual(7n);
  });
});

describe('merkle tree', () => {
  const entries = [1, 2, 3, 4, 5].map((n) => ({
    address: addr(n),
    amount: BigInt(n) * 100n * USD,
  }));

  it('gives every entry a proof that verifies against the root', () => {
    const { root, proofs } = buildTree(entries);
    for (const e of entries)
      expect(verifyProof(root, e.address, e.amount, proofs.get(e.address)!)).toBe(true);
  });

  it('rejects a different amount, a different address, or someone else’s proof', () => {
    const { root, proofs } = buildTree(entries);
    const e = entries[0]!;
    expect(verifyProof(root, e.address, e.amount + 1n, proofs.get(e.address)!)).toBe(false);
    expect(verifyProof(root, addr(99), e.amount, proofs.get(e.address)!)).toBe(false);
    expect(verifyProof(root, e.address, e.amount, proofs.get(entries[1]!.address)!)).toBe(false);
  });

  it('has the same root whatever order the entries are given in', () => {
    expect(buildTree([...entries].reverse()).root).toBe(buildTree(entries).root);
  });

  it('works for a single entry', () => {
    const { root, proofs } = buildTree([entries[0]!]);
    expect(
      verifyProof(root, entries[0]!.address, entries[0]!.amount, proofs.get(entries[0]!.address)!),
    ).toBe(true);
  });

  it('has a zero root and no valid claim when there are no entries', () => {
    const { root, proofs } = buildTree([]);
    expect(root).toBe(EMPTY_ROOT);
    expect(proofs.size).toBe(0);
    expect(verifyProof(root, addr(1), 1n, [])).toBe(false);
  });

  it('refuses a repeated address', () => {
    expect(() => buildTree([entries[0]!, entries[0]!])).toThrow('Duplicate');
  });
});

describe('computeSeasonResults', () => {
  const DAY = 86_400_000;
  const start = 1_800_000_000_000;
  const end = start + 7 * DAY;

  function inputs(over: Partial<ResultInputs> = {}): ResultInputs {
    return {
      seasonId: 1,
      startMs: start,
      endMs: end,
      pot: 1000n * USD,
      fighterPotBps: 7500,
      prizeCurveBps: PRIZE_CURVE_BPS,
      minDuels: 10,
      backerMinDeposit: 100n * USD,
      scores: [score(1, 90, 9), score(2, 80, 8), score(3, 70, 7), score(4, 60, 6, 9)],
      picks: [
        { backer: addr(90), fighter: addr(1) },
        { backer: addr(91), fighter: addr(2) },
        { backer: addr(92), fighter: addr(2) },
      ],
      balanceEvents: new Map([
        [addr(90), [{ at: start - 100_000, delta: 200n * USD }]],
        [addr(91), [{ at: start - 100_000, delta: 100n * USD }]],
        [addr(92), [{ at: start - 100_000, delta: 300n * USD }]],
      ]),
      ...over,
    };
  }

  it('splits the pot 75 / 25 into fighter prizes and backer bonuses', () => {
    const r = computeSeasonResults(inputs());
    expect(r.fighterPool).toBe(750n * USD);
    expect(r.backerPool).toBe(250n * USD);
    expect(r.ranked.map((f) => f.address)).toEqual([addr(1), addr(2), addr(3)]);
    expect(r.prizes.map((p) => p.amount)).toEqual([187_500_000n, 127_500_000n, 97_500_000n]);
  });

  it('accounts for every unit of the pot: payouts plus rollover equal the pot', () => {
    const r = computeSeasonResults(inputs());
    expect(r.payoutTotal + r.dust).toBe(1000n * USD);
    expect(r.payoutTotal).toBeLessThanOrEqual(1000n * USD);
    expect(r.dust).toBeGreaterThan(0n); // ranks 4-20 are empty
  });

  it('leaves out a backer who withdrew below the minimum before the season ended', () => {
    const base = inputs();
    const events = new Map(base.balanceEvents);
    events.set(addr(92), [
      { at: start - 100_000, delta: 300n * USD },
      { at: end - 10_000, delta: -250n * USD },
    ]);
    const r = computeSeasonResults(inputs({ balanceEvents: events }));
    expect(r.bonuses.map((b) => b.address)).not.toContain(addr(92));
    expect(r.bonuses.map((b) => b.address)).toContain(addr(91));
  });

  it('has proofs for every prize and bonus', () => {
    const r = computeSeasonResults(inputs());
    for (const p of r.prizes)
      expect(
        verifyProof(r.prizeTree.root, p.address, p.amount, r.prizeTree.proofs.get(p.address)!),
      ).toBe(true);
    for (const b of r.bonuses)
      expect(
        verifyProof(r.bonusTree.root, b.address, b.amount, r.bonusTree.proofs.get(b.address)!),
      ).toBe(true);
  });

  it('has empty trees for a season nobody qualified in', () => {
    const r = computeSeasonResults(inputs({ scores: [score(1, 10, 1, 3)] }));
    expect(r.prizes).toEqual([]);
    expect(r.prizeTree.root).toBe(EMPTY_ROOT);
    expect(r.bonusTree.root).toBe(EMPTY_ROOT);
    expect(r.dust).toBe(1000n * USD);
  });

  describe('inputs hash', () => {
    it('does not change when the same data is read in another order', () => {
      const a = inputs();
      const b = inputs({
        scores: [...a.scores].reverse(),
        picks: [...a.picks].reverse(),
        balanceEvents: new Map([...a.balanceEvents.entries()].reverse()),
      });
      expect(hashInputs(b)).toBe(hashInputs(a));
      expect(computeSeasonResults(b).prizeTree.root).toBe(computeSeasonResults(a).prizeTree.root);
    });

    it('changes when any input changes', () => {
      const base = hashInputs(inputs());
      expect(hashInputs(inputs({ pot: 1001n * USD }))).not.toBe(base);
      expect(
        hashInputs(
          inputs({
            scores: [score(1, 91, 9), score(2, 80, 8), score(3, 70, 7), score(4, 60, 6, 9)],
          }),
        ),
      ).not.toBe(base);
      expect(hashInputs(inputs({ picks: [{ backer: addr(90), fighter: addr(2) }] }))).not.toBe(
        base,
      );
    });
  });
});

/** A small seeded generator, so a failing case can be reproduced. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('invariants over random seasons', () => {
  const DAY = 86_400_000;
  const start = 1_800_000_000_000;

  function randomInputs(seed: number): ResultInputs {
    const r = rng(seed);
    const int = (max: number) => Math.floor(r() * max);
    const fighters = int(40);
    const scores = Array.from({ length: fighters }, (_, i) =>
      score(i + 1, int(6), int(4), int(14), r() < 0.2 ? null : 1000 + int(5)),
    );
    const backers = int(30);
    const picks = Array.from({ length: backers }, (_, i) => ({
      backer: addr(1000 + i),
      fighter: addr(1 + int(fighters + 3)),
    }));
    const balanceEvents = new Map(
      picks.map((p) => [
        p.backer,
        Array.from({ length: 1 + int(4) }, () => ({
          at: start - DAY + int(8 * DAY),
          delta: BigInt(r() < 0.3 ? -int(150) : int(400)) * USD,
        })),
      ]),
    );
    return {
      seasonId: 1,
      startMs: start,
      endMs: start + 7 * DAY,
      pot: BigInt(int(2_000_000)) * 1000n + BigInt(int(1000)),
      fighterPotBps: 7500,
      prizeCurveBps: PRIZE_CURVE_BPS,
      minDuels: 10,
      backerMinDeposit: 100n * USD,
      scores,
      picks,
      balanceEvents,
    };
  }

  const shuffled = <T>(items: readonly T[], seed: number) => {
    const r = rng(seed);
    return items
      .map((x) => [r(), x] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([, x]) => x);
  };

  it.each(Array.from({ length: 300 }, (_, i) => i + 1))(
    'season %i keeps the money rules',
    (seed) => {
      const i = randomInputs(seed);
      const r = computeSeasonResults(i);

      // Never pay more than the pot, and every unit is either paid or rolled over.
      expect(r.payoutTotal).toBeLessThanOrEqual(i.pot);
      expect(r.payoutTotal + r.dust).toBe(i.pot);
      // Fighters get no more than their pool, backers no more than theirs.
      expect(r.prizes.reduce((s, p) => s + p.amount, 0n)).toBeLessThanOrEqual(r.fighterPool);
      expect(r.bonuses.reduce((s, b) => s + b.amount, 0n)).toBeLessThanOrEqual(r.backerPool);
      // Only qualified fighters win, at most one prize per wallet, at most 20 prizes.
      const qualified = new Set(
        i.scores.filter((s) => s.duels >= i.minDuels).map((s) => s.address),
      );
      expect(r.prizes.every((p) => qualified.has(p.address))).toBe(true);
      expect(new Set(r.prizes.map((p) => p.address)).size).toBe(r.prizes.length);
      expect(r.prizes.length).toBeLessThanOrEqual(PRIZE_CURVE_BPS.length);
      // A bonus is only for a backer who picked a fighter that won a prize.
      const winners = new Set(r.prizes.map((p) => p.address));
      const pickOf = new Map(i.picks.map((p) => [p.backer, p.fighter]));
      expect(r.bonuses.every((b) => winners.has(pickOf.get(b.address)!))).toBe(true);
      // Every claim has a valid proof.
      for (const p of r.prizes)
        expect(
          verifyProof(r.prizeTree.root, p.address, p.amount, r.prizeTree.proofs.get(p.address)!),
        ).toBe(true);
      for (const b of r.bonuses)
        expect(
          verifyProof(r.bonusTree.root, b.address, b.amount, r.bonusTree.proofs.get(b.address)!),
        ).toBe(true);
    },
  );

  it.each(Array.from({ length: 60 }, (_, i) => i + 1))(
    'season %i gives the same result in any input order',
    (seed) => {
      const i = randomInputs(seed);
      const a = computeSeasonResults(i);
      const b = computeSeasonResults({
        ...i,
        scores: shuffled(i.scores, seed),
        picks: shuffled(i.picks, seed + 1),
        balanceEvents: new Map(shuffled([...i.balanceEvents.entries()], seed + 2)),
      });
      expect(b.prizeTree.root).toBe(a.prizeTree.root);
      expect(b.bonusTree.root).toBe(a.bonusTree.root);
      expect(b.inputsHash).toBe(a.inputsHash);
      expect(b.payoutTotal).toBe(a.payoutTotal);
    },
  );

  // Rounding is where a payout could exceed the pot, so fill every rank and use small, awkward pots.
  it.each(Array.from({ length: 200 }, (_, i) => i + 1))(
    'with every rank filled and a small pot %i, rounding never pays out more than the pot',
    (seed) => {
      const r = rng(seed * 7919);
      const pot = BigInt(1 + Math.floor(r() * 10_000));
      const scores = Array.from({ length: 25 }, (_, i) =>
        score(i + 1, 100 - i, 5, 10 + Math.floor(r() * 5)),
      );
      const backers = Array.from({ length: 30 }, (_, i) => ({
        backer: addr(1000 + i),
        fighter: addr(1 + Math.floor(r() * 25)),
      }));
      const result = computeSeasonResults({
        seasonId: 1,
        startMs: start,
        endMs: start + 7 * DAY,
        pot,
        fighterPotBps: 7500,
        prizeCurveBps: PRIZE_CURVE_BPS,
        minDuels: 10,
        backerMinDeposit: 100n * USD,
        scores,
        picks: backers,
        balanceEvents: new Map(
          backers.map((b) => [
            b.backer,
            [{ at: start - 10_000, delta: BigInt(100 + Math.floor(r() * 900)) * USD }],
          ]),
        ),
      });
      expect(result.prizes.reduce((sum, p) => sum + p.amount, 0n)).toBeLessThanOrEqual(
        result.fighterPool,
      );
      expect(result.bonuses.reduce((sum, b) => sum + b.amount, 0n)).toBeLessThanOrEqual(
        result.backerPool,
      );
      expect(result.payoutTotal + result.dust).toBe(pot);
    },
  );
});
