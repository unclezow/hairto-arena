import { createHash } from 'node:crypto';
import { bonusAmounts, type Bonus, type PickInput } from './bonuses.js';
import { buildTree, type BuiltTree } from './merkle.js';
import { prizeAmounts, type Prize } from './prizes.js';
import { rankFighters, type RankedFighter, type ScoreInput } from './ranking.js';
import { balanceAt, twab, type BalanceEvent } from './twab.js';

const BPS = 10_000n;

export interface ResultInputs {
  seasonId: number;
  /** Unix ms of the season start and end. */
  startMs: number;
  endMs: number;
  /** The season pot as the arena holds it (`pot_of`), in USDC base units. */
  pot: bigint;
  /** Share of the pot paid to Fighters, in basis points; the rest is the Backer bonus pool. */
  fighterPotBps: number;
  prizeCurveBps: readonly number[];
  minDuels: number;
  /** Least the Backer pool balance a Backer must hold at the season end to take part. */
  backerMinDeposit: bigint;
  scores: readonly ScoreInput[];
  picks: readonly PickInput[];
  /** Backer pool deposits and withdrawals of the picking Backers. */
  balanceEvents: ReadonlyMap<string, readonly BalanceEvent[]>;
}

export interface SeasonResults {
  ranked: RankedFighter[];
  prizes: Prize[];
  bonuses: Bonus[];
  twabByBacker: Map<string, bigint>;
  fighterPool: bigint;
  backerPool: bigint;
  payoutTotal: bigint;
  /** Pot that was not paid out: floored remainders and prize shares nobody filled. It rolls over. */
  dust: bigint;
  prizeTree: BuiltTree;
  bonusTree: BuiltTree;
  inputsHash: string;
}

/** Everything the keeper posts for a season, from plain data. No clock, no database, no randomness. */
export function computeSeasonResults(inputs: ResultInputs): SeasonResults {
  const fighterPool = (inputs.pot * BigInt(inputs.fighterPotBps)) / BPS;
  // Floored like fighterPool: `post_results` caps the bonus total at floor(pot * backerBps / BPS).
  const backerPool = (inputs.pot * (BPS - BigInt(inputs.fighterPotBps))) / BPS;

  const ranked = rankFighters(inputs.scores, inputs.minDuels);
  const prizes = prizeAmounts(fighterPool, inputs.prizeCurveBps, ranked);

  // Only a backer who still holds the minimum when the season ends takes part.
  const twabByBacker = new Map<string, bigint>();
  for (const [backer, events] of inputs.balanceEvents) {
    if (balanceAt(events, inputs.endMs) < inputs.backerMinDeposit) continue;
    twabByBacker.set(backer, twab(events, inputs.startMs, inputs.endMs));
  }
  const bonuses = bonusAmounts({ backerPool, prizes, picks: inputs.picks, twabByBacker });

  const payoutTotal = [...prizes, ...bonuses].reduce((sum, p) => sum + p.amount, 0n);
  if (payoutTotal > inputs.pot) throw new Error('Payouts exceed the pot'); // cannot happen with floored shares

  return {
    ranked,
    prizes,
    bonuses,
    twabByBacker,
    fighterPool,
    backerPool,
    payoutTotal,
    dust: inputs.pot - payoutTotal,
    prizeTree: buildTree(prizes),
    bonusTree: buildTree(bonuses),
    inputsHash: hashInputs(inputs),
  };
}

/** A fingerprint of the inputs that does not depend on the order they were read in. */
export function hashInputs(inputs: ResultInputs): string {
  const canonical = {
    seasonId: inputs.seasonId,
    startMs: inputs.startMs,
    endMs: inputs.endMs,
    pot: inputs.pot.toString(),
    fighterPotBps: inputs.fighterPotBps,
    prizeCurveBps: inputs.prizeCurveBps,
    minDuels: inputs.minDuels,
    backerMinDeposit: inputs.backerMinDeposit.toString(),
    scores: [...inputs.scores]
      .sort((a, b) => (a.address < b.address ? -1 : 1))
      .map((s) => [s.address, s.points, s.wins, s.duels, s.reachedAt]),
    picks: [...inputs.picks]
      .sort((a, b) => (a.backer < b.backer ? -1 : 1))
      .map((p) => [p.backer, p.fighter]),
    balances: [...inputs.balanceEvents.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([backer, events]) => [backer, events.map((e) => [e.at, e.delta.toString()])]),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
