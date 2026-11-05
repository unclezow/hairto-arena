'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';

/** Wait for mounted assets to be drawn, not just downloaded, before revealing. */
export function SceneReady({ onReady }: { onReady: () => void }) {
  const frames = useRef(0);
  const notified = useRef(false);
  const pending = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (pending.current !== null) cancelAnimationFrame(pending.current);
    },
    [],
  );
  useFrame(({ invalidate }) => {
    if (notified.current) return;
    if (frames.current++ < 2) {
      invalidate();
      return;
    }
    notified.current = true;
    pending.current = requestAnimationFrame(() => onReady());
  });
  return null;
}
