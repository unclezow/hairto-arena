'use client';

import { useEffect, useState } from 'react';
import './arena-leave-guard.css';

/**
 * While a duel is running the player cannot walk out of it: the browser's back button and a reload are caught and
 * the player is told why. A dummy history entry is stacked so "back" lands on the same arena URL instead of leaving.
 */
export function ArenaLeaveGuard({ active }: { active: boolean }) {
  const [warning, setWarning] = useState(false);

  useEffect(() => {
    if (!active) return;
    window.history.pushState(window.history.state, '', window.location.href);
    const onPop = () => {
      window.history.pushState(window.history.state, '', window.location.href);
      setWarning(true);
    };
    const onUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('popstate', onPop);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('beforeunload', onUnload);
      setWarning(false);
    };
  }, [active]);

  useEffect(() => {
    if (!warning) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setWarning(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [warning]);

  if (!active || !warning) return null;
  return (
    <div
      className="leave-guard"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="leave-guard-title"
    >
      <div className="leave-guard-box">
        <h2 id="leave-guard-title">DUEL IN PROGRESS</h2>
        <p>You cannot leave a duel once it has started. Finish the round to see your result.</p>
        <button type="button" autoFocus onClick={() => setWarning(false)}>
          BACK TO THE DUEL
        </button>
      </div>
    </div>
  );
}
