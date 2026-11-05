import type { PriceTick } from './bot-strategy.js';

/** Price change over the last `n` ticks in basis points, or 0 when there is not enough history. */
export function changeBps(ticks: readonly PriceTick[], n: number): number {
  if (ticks.length < 2) return 0;
  const last = ticks[ticks.length - 1]!;
  const first = ticks[Math.max(0, ticks.length - 1 - n)]!;
  return ((last.price - first.price) / first.price) * 10_000;
}

export function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdev(values: readonly number[]): number {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/** Window of the most recent `n` prices. */
export function recentPrices(ticks: readonly PriceTick[], n: number): number[] {
  return ticks.slice(-n).map((t) => t.price);
}
