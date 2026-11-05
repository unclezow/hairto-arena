'use client';

import { useEffect, useId, useRef } from 'react';
import type { ReadinessStep } from '@/hooks/use-fighter-readiness';
import './connect-modal.css';
import './battle-dialog.css';

export type BattleFlow =
  | { kind: 'working'; phase: 'signin' | 'prepare' | 'start' | 'enter' }
  | { kind: 'error'; title: string; hint: string };

/** What the player is waiting on, in the words of the popup. */
function workingCopy(phase: 'signin' | 'prepare' | 'start' | 'enter', step: ReadinessStep) {
  if (phase === 'signin')
    return { title: 'SIGN IN', hint: 'Sign the message in your wallet to log in.' };
  if (phase === 'prepare')
    return step === 'preparing'
      ? { title: 'PREPARE BATTLE', hint: 'Confirm the transaction in your wallet.' }
      : { title: 'PREPARE BATTLE', hint: 'Checking your deposit and wallet…' };
  if (phase === 'start')
    return {
      title: 'START BATTLE',
      hint: 'Sign the duel request in your wallet. The bot enters the arena next.',
    };
  return { title: 'ENTERING THE ARENA', hint: 'Hold on, loading your duel…' };
}

/**
 * Progress and errors of the BATTLE button, shown in the middle of the lobby instead of a caption on the button
 * where they were easy to miss.
 */
export function BattleDialog({
  flow,
  step,
  onClose,
  onRetry,
}: {
  flow: BattleFlow;
  step: ReadinessStep;
  onClose: () => void;
  onRetry: () => void;
}) {
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const failed = flow.kind === 'error';
  const copy = failed ? flow : workingCopy(flow.phase, step);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    root.current?.querySelector<HTMLElement>('button:not(.connect-close)')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="connect-overlay"
      onPointerDown={(e) => e.target === e.currentTarget && failed && onClose()}
    >
      <div
        ref={root}
        className="connect-modal battle-dialog"
        role={failed ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={!failed}
      >
        <button type="button" className="connect-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {!failed && <span className="battle-spinner" aria-hidden="true" />}
        <h2 id={titleId}>{copy.title}</h2>
        {failed ? (
          <p className="connect-error" role="alert">
            {copy.hint}
          </p>
        ) : (
          <p className="connect-note connect-note-center" role="status">
            {copy.hint}
          </p>
        )}
        {failed && (
          <div className="connect-actions">
            <button type="button" className="connect-primary" onClick={onRetry}>
              TRY AGAIN
            </button>
            <button type="button" className="connect-link" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
