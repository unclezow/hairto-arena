/** Estimates behind the season page. Pure bigint math: amounts are token base units. */

const BPS = 10_000n;
/** 52 weeks per year, so a 7 day season earns exactly 1/52 of the yearly yield. */
const ESTIMATE_YEAR_SEC = 52n * 7n * 24n * 60n * 60n;

export type SplitMode = 'afterFee' | 'gross';

export interface VaultEstimateInput {
  tvl: bigint;
  feeBps: number;
  /** Share of the yield that goes back to depositors; the rest funds the pot. */
  ownerShareBps: number;
  /** `afterFee`: the share is taken from what is left after the fee. `gross`: from the whole yield. */
  splitMode?: SplitMode;
}

export interface VaultEstimate {
  grossYield: bigint;
  fee: bigint;
  toOwners: bigint;
  toPot: bigint;
}

export function estimateVault(
  v: VaultEstimateInput,
  apyBps: number,
  seasonSec: number,
): VaultEstimate {
  const grossYield = (v.tvl * BigInt(apyBps) * BigInt(seasonSec)) / (BPS * ESTIMATE_YEAR_SEC);
  const fee = (grossYield * BigInt(v.feeBps)) / BPS;
  const base = v.splitMode === 'gross' ? grossYield : grossYield - fee;
  const toOwners = (base * BigInt(v.ownerShareBps)) / BPS;
  return { grossYield, fee, toOwners, toPot: grossYield - fee - toOwners };
}

export function potSplit(pot: bigint, fighterBps: number) {
  const fighterPool = (pot * BigInt(fighterBps)) / BPS;
  return { fighterPool, backerPool: pot - fighterPool };
}

/** What `rank` earns from a Fighter pool, flooring like the on-chain split will. */
export function fighterPrize(fighterPool: bigint, prizeBps: number): bigint {
  return (fighterPool * BigInt(prizeBps)) / BPS;
}

/**
 * Backer bonus: `BonusPool x (prize_f / totalPrize) x (TWAB_i / TWAB_total_f)`.
 * `totalPrizeBps` is the sum of the shares of the ranks that actually have a Fighter.
 */
export function bonusEstimate(input: {
  backerPool: bigint;
  pickedFighterPrizeBps: number;
  totalPrizeBps: number;
  myTwab: bigint;
  totalTwabOfPickedFighter: bigint;
}): bigint {
  if (
    input.pickedFighterPrizeBps === 0 ||
    input.totalPrizeBps === 0 ||
    input.totalTwabOfPickedFighter === 0n
  )
    return 0n;
  return (
    (input.backerPool * BigInt(input.pickedFighterPrizeBps) * input.myTwab) /
    (BigInt(input.totalPrizeBps) * input.totalTwabOfPickedFighter)
  );
}
