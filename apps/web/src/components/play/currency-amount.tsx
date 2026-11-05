'use client';

import { useEffect, useRef } from 'react';

export function CurrencyAmount({ value, symbol }: { value: string; symbol: string }) {
  const container = useRef<HTMLSpanElement>(null);
  const amount = useRef<HTMLElement>(null);

  useEffect(() => {
    const box = container.current;
    const text = amount.current;
    if (!box || !text) return;
    let mounted = true;
    const fit = () => {
      if (!mounted) return;
      text.style.removeProperty('font-size');
      const base = parseFloat(getComputedStyle(text).fontSize);
      const width = text.getBoundingClientRect().width;
      if (width > box.clientWidth && box.clientWidth > 0) {
        text.style.fontSize = `${(base * box.clientWidth) / width}px`;
      }
    };
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    void document.fonts.ready.then(fit);
    fit();
    return () => {
      mounted = false;
      observer.disconnect();
    };
  }, [value]);

  return (
    <span className="hub-currency-amount" ref={container} title={`${value} ${symbol}`}>
      <strong ref={amount}>{value}</strong>
      <small>{symbol}</small>
    </span>
  );
}
