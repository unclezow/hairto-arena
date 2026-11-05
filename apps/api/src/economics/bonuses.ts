import type { Prize } from './prizes.js';

export interface PickInput {
  backer: string;
  fighter: string;
}

export interface Bonus {
  address: string;
  fighter: string;
  amount: bigint;
}

/**
 * Backer bonus: `BonusPool x (prize_f / totalPrize) x (TWAB_i / TWAB_total_f)`, where `f` is the fighter
 * the backer picked. A backer whose fighter won no prize, who was not eligible at the snapshot, or whose TWAB is
 * zero gets nothing. Every share is floored, so the total never exceeds the pool.
 */
export function bonusAmounts(input: {
  backerPool: bigint;
  prizes: readonly Prize[];
  picks: readonly PickInput[];
  /** TWAB of each eligible backer over the season. A backer missing here is not eligible. */
  twabByBacker: ReadonlyMap<string, bigint>;
}): Bonus[] {
  const prizeOf = new Map(input.prizes.map((p) => [p.address, p.amount]));
  const totalPrize = input.prizes.reduce((sum, p) => sum + p.amount, 0n);
  if (totalPrize === 0n) return [];

  const eligible = input.picks.filter(
    (p) => prizeOf.has(p.fighter) && (input.twabByBacker.get(p.backer) ?? 0n) > 0n,
  );
  const twabTotal = new Map<string, bigint>();
  for (const p of eligible) {
    twabTotal.set(p.fighter, (twabTotal.get(p.fighter) ?? 0n) + input.twabByBacker.get(p.backer)!);
  }

  return eligible
    .map((p) => ({
      address: p.backer,
      fighter: p.fighter,
      amount:
        (input.backerPool * prizeOf.get(p.fighter)! * input.twabByBacker.get(p.backer)!) /
        (totalPrize * twabTotal.get(p.fighter)!),
    }))
    .filter((b) => b.amount > 0n);
}
