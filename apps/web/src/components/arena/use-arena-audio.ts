'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { ArenaAudio } from './arena-audio';

export function useArenaAudio(scene: 'arena' | 'lobby' = 'arena') {
  const [engine] = useState(() => new ArenaAudio());
  const snapshot = useSyncExternalStore(
    engine.subscribe,
    engine.getSnapshot,
    engine.getServerSnapshot,
  );
  useEffect(() => {
    engine.mount(scene);
    if (scene === 'lobby') engine.finishIntro();
    // Try normal autoplay on every visit. Browsers that require a gesture keep
    // resume() pending; the trusted interaction handlers below then resume it.
    void engine.unlock();
    const wake = (event: Event) => {
      // The speaker handles its own click; unlocking on pointerdown would make
      // that first click immediately mute the context it just enabled.
      if (event.target instanceof Element && event.target.closest('.arena-speaker-button')) return;
      if (event.isTrusted) void engine.unlock();
    };
    const visibility = () => engine.visibility();
    document.addEventListener('pointerdown', wake, { capture: true, passive: true });
    document.addEventListener('keydown', wake, { capture: true, passive: true });
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('pointerdown', wake, true);
      document.removeEventListener('keydown', wake, true);
      document.removeEventListener('visibilitychange', visibility);
      engine.close();
    };
  }, [engine, scene]);
  return { engine, snapshot };
}
