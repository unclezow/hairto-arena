'use client';

import { useEffect, useRef, useState } from 'react';

type ChartFrame = { price: number; low: number; high: number };

/** Presentation only: actual quotes and transaction prices remain untouched. */
export function useChartTransition(target: ChartFrame, market: string) {
  const [frame, setFrame] = useState(target);
  const visible = useRef(target);
  const previousMarket = useRef(market);
  const { price, low, high } = target;

  useEffect(() => {
    const next = { price, low, high };
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const from = visible.current;
    const marketChanged = previousMarket.current !== market;
    previousMarket.current = market;
    let animation = 0;
    let stopped = false;
    const commit = (value: ChartFrame) => {
      visible.current = value;
      setFrame(value);
    };
    const finish = () => {
      stopped = true;
      cancelAnimationFrame(animation);
      commit(next);
    };
    const onVisibility = () => {
      if (document.hidden) finish();
    };
    const onMotion = () => {
      if (motion.matches) finish();
    };

    if (marketChanged || from.price <= 0 || price <= 0 || motion.matches || document.hidden) {
      commit(next);
      return;
    }
    if (from.price === price && from.low === low && from.high === high) return;

    const started = performance.now();
    const update = (now: number) => {
      if (stopped) return;
      const progress = Math.min(1, (now - started) / 250);
      commit({
        price: from.price + (price - from.price) * progress,
        low: from.low + (low - from.low) * progress,
        high: from.high + (high - from.high) * progress,
      });
      if (progress < 1) animation = requestAnimationFrame(update);
    };
    animation = requestAnimationFrame(update);
    document.addEventListener('visibilitychange', onVisibility);
    motion.addEventListener('change', onMotion);
    return () => {
      stopped = true;
      cancelAnimationFrame(animation);
      document.removeEventListener('visibilitychange', onVisibility);
      motion.removeEventListener('change', onMotion);
    };
  }, [price, low, high, market]);

  return frame;
}
