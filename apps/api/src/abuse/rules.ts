/**
 * Abuse heuristics as pure functions over one fighter's season. They only describe a pattern; nothing
 * here, or built on it, changes a score, a rank or a prize. Every finding carries what it was computed from, so a
 * reviewer can redo it by hand.
 */

export interface AbuseThresholds {
  minDuels: number;
  lv1Share: number;
  lv1WinRate: number;
  maxCountedPerDay: number | null;
  capDays: number;
  intervalCv: number;
  baselineWinRate: number;
  winRateZ: number;
  cycleCount: number;
  cycleWindowSec: number;
  /** the Fighter pool minimum deposit, in token base units. */
  minDeposit: bigint;
}

export type RuleName = 'easy-bot-farming' | 'cap-hugging' | 'winrate-outlier' | 'deposit-cycling';

export interface Finding {
  rule: RuleName;
  score: number;
  evidence: Record<string, unknown>;
}

/** A finished duel that counted towards points. */
export interface CountedDuel {
  level: number;
  result: 'win' | 'draw' | 'loss';
}

export interface FighterSeasonData {
  /** Finished duels that counted. */
  counted: CountedDuel[];
  /** When every non voided duel was started, in unix seconds, counted or not. */
  startTimes: number[];
  /** the Fighter pool balance changes in order: positive deposit, negative withdrawal. */
  balanceEvents: { at: number; delta: bigint }[];
}

export interface Window {
  from: number;
  to: number;
}

const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);

export function easyBotFarming(
  d: FighterSeasonData,
  t: AbuseThresholds,
  w: Window,
): Finding | null {
  const n = d.counted.length;
  if (n < t.minDuels) return null;
  const lv1 = d.counted.filter((x) => x.level === 1);
  const wins = lv1.filter((x) => x.result === 'win').length;
  const share = ratio(lv1.length, n);
  const winRate = ratio(wins, lv1.length);
  if (share < t.lv1Share || winRate < t.lv1WinRate) return null;
  return {
    rule: 'easy-bot-farming',
    score: share * winRate,
    evidence: {
      window: w,
      parameters: { minDuels: t.minDuels, lv1Share: t.lv1Share, lv1WinRate: t.lv1WinRate },
      counted: n,
      lv1Duels: lv1.length,
      lv1Wins: wins,
      lv1Share: share,
      lv1WinRate: winRate,
    },
  };
}

const DAY = 86_400;

export function capHugging(d: FighterSeasonData, t: AbuseThresholds, w: Window): Finding | null {
  if (t.maxCountedPerDay === null) return null;
  const byDay = new Map<number, number[]>();
  for (const at of [...d.startTimes].sort((a, b) => a - b)) {
    const day = Math.floor(at / DAY);
    byDay.set(day, [...(byDay.get(day) ?? []), at]);
  }
  const cap = t.maxCountedPerDay;
  const capped = [...byDay.entries()].filter(([, times]) => times.length >= cap);
  if (capped.length < t.capDays) return null;

  const gaps = capped.flatMap(([, times]) => times.slice(1).map((at, i) => at - times[i]!));
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (mean <= 0) return null;
  const variance = gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length;
  const cv = Math.sqrt(variance) / mean;
  if (cv > t.intervalCv) return null;

  return {
    rule: 'cap-hugging',
    score: 1 - cv,
    evidence: {
      window: w,
      parameters: { cap: t.maxCountedPerDay, capDays: t.capDays, intervalCv: t.intervalCv },
      cappedDays: capped.map(([day]) => new Date(day * DAY * 1000).toISOString().slice(0, 10)),
      meanGapSec: mean,
      gapCv: cv,
    },
  };
}

export function winRateOutlier(
  d: FighterSeasonData,
  t: AbuseThresholds,
  w: Window,
): Finding | null {
  const n = d.counted.length;
  if (n < t.minDuels) return null;
  const wins = d.counted.filter((x) => x.result === 'win').length;
  const p = t.baselineWinRate;
  const z = (wins - n * p) / Math.sqrt(n * p * (1 - p));
  if (!(z >= t.winRateZ)) return null;
  return {
    rule: 'winrate-outlier',
    score: z,
    evidence: {
      window: w,
      parameters: { minDuels: t.minDuels, baselineWinRate: p, winRateZ: t.winRateZ },
      counted: n,
      wins,
      winRate: wins / n,
      z,
    },
  };
}

/**
 * Balance dips below the Fighter pool minimum and is back above it within the window, with a duel started close to
 * it, again and again: a way to play on a deposit that is mostly not there.
 */
export function depositCycling(
  d: FighterSeasonData,
  t: AbuseThresholds,
  w: Window,
): Finding | null {
  let balance = 0n;
  let dippedAt: number | null = null;
  const cycles: { dippedAt: number; restoredAt: number }[] = [];

  for (const e of [...d.balanceEvents].sort((a, b) => a.at - b.at)) {
    const before = balance;
    balance += e.delta;
    if (before >= t.minDeposit && balance < t.minDeposit) dippedAt = e.at;
    else if (dippedAt !== null && balance >= t.minDeposit) {
      const restoredAt = e.at;
      const near = d.startTimes.some(
        (s) => s >= dippedAt! - t.cycleWindowSec && s <= restoredAt + t.cycleWindowSec,
      );
      if (restoredAt - dippedAt <= t.cycleWindowSec && near) cycles.push({ dippedAt, restoredAt });
      dippedAt = null;
    }
  }
  if (cycles.length < t.cycleCount) return null;
  return {
    rule: 'deposit-cycling',
    score: cycles.length,
    evidence: {
      window: w,
      parameters: {
        minDeposit: t.minDeposit.toString(),
        cycleCount: t.cycleCount,
        cycleWindowSec: t.cycleWindowSec,
      },
      cycles,
    },
  };
}

export const RULES = [easyBotFarming, capHugging, winRateOutlier, depositCycling] as const;

export function evaluate(d: FighterSeasonData, t: AbuseThresholds, w: Window): Finding[] {
  return RULES.map((rule) => rule(d, t, w)).filter((f): f is Finding => f !== null);
}
