/**
 * HP model for previews and replays. Mirrors the arena's `DamageConfig` (`contracts/arena/src/damage.rs`) and the
 * way the arena applies it, so a backend strategy and a damage configuration can be swapped together.
 * PnL is in ppm (1 ppm = 0.01 bps). The contract's result is the truth.
 */
export interface DamageDelta {
  /** HP change for the owner of the closed position (zero or negative). */
  selfDelta: number;
  /** HP change for the opponent (zero or negative). */
  opponentDelta: number;
}

export interface DamageStrategy {
  readonly name: string;
  /** Paper cost (ppm) taken off a trade's gross PnL before it is scored. */
  paperCost(assetId: number): number;
  /** Effect of one closed paper position, `netPnlPpm` signed. */
  computeDamage(netPnlPpm: number, assetId: number): DamageDelta;
  /** Net PnL (ppm, negative) charged to a position never revealed, given the absolute open-to-end move. */
  unrevealedPenalty(absMovePpm: number, assetId: number): number;
}

export type Side = 'fighter' | 'bot';

export interface ClosedTrade {
  side: Side;
  /** Net PnL as the arena scored it: from `position_closed` or `position_penalized`. */
  pnlPpm: number;
}

export interface DuelOutcome {
  hpFighter: number;
  hpBot: number;
  winner: Side | 'draw';
  /** Sum of net PnL per side: what decides the winner. */
  score: Record<Side, number>;
  /** HP taken from the opponent, per side: the first tie-breaker. */
  damageDealt: Record<Side, number>;
}

/**
 * Applies trades in order, as the arena does: score += net PnL, HP clamped to [0, startingHp] after every
 * delta, damage dealt counted before clamping. Winner: higher score, then more damage dealt, then more HP,
 * otherwise a draw.
 */
export function resolveDuel(
  strategy: DamageStrategy,
  options: { startingHp: number; assetId: number; trades: readonly ClosedTrade[] },
): DuelOutcome {
  const hp: Record<Side, number> = { fighter: options.startingHp, bot: options.startingHp };
  const score: Record<Side, number> = { fighter: 0, bot: 0 };
  const dealt: Record<Side, number> = { fighter: 0, bot: 0 };
  const other = (side: Side): Side => (side === 'fighter' ? 'bot' : 'fighter');
  const clamp = (v: number) => Math.min(options.startingHp, Math.max(0, v));

  for (const trade of options.trades) {
    const { selfDelta, opponentDelta } = strategy.computeDamage(trade.pnlPpm, options.assetId);
    score[trade.side] += trade.pnlPpm;
    dealt[trade.side] += -opponentDelta;
    hp[trade.side] = clamp(hp[trade.side] + selfDelta);
    hp[other(trade.side)] = clamp(hp[other(trade.side)] + opponentDelta);
  }

  const result = { hpFighter: hp.fighter, hpBot: hp.bot, score, damageDealt: dealt };
  for (const [a, b] of [
    [score.fighter, score.bot],
    [dealt.fighter, dealt.bot],
    [hp.fighter, hp.bot],
  ] as const) {
    if (a !== b) return { ...result, winner: a > b ? 'fighter' : 'bot' };
  }
  return { ...result, winner: 'draw' };
}
