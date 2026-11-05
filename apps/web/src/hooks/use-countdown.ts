'use client';

import { useEffect, useState } from 'react';

/** `hh:mm:ss` until `target` (ISO), ticking every second; `00:00:00` once it has passed or when there is none. */
export function useCountdown(target: string | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [target]);
  const left = target ? Math.max(0, Math.ceil((Date.parse(target) - now) / 1000)) : 0;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(left / 3600))}:${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`;
}
