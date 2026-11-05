'use client';

import './arena-settling.css';

/**
 * Shown from the moment the round hits zero until the result page takes over. Nothing can be traded any more, and
 * the chain needs a while to close the duel, so say so instead of leaving a frozen arena.
 */
export function ArenaSettling({ phase }: { phase: 'reveal' | 'over' | 'ko' }) {
  return (
    <div
      className="arena-settling"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="settling-title"
    >
      <div className="arena-settling-box">
        <h2 id="settling-title">
          {phase === 'over' ? 'RESULT READY' : phase === 'ko' ? 'K.O.!' : 'TIME’S UP'}
        </h2>
        <p>
          {phase === 'over'
            ? 'Opening your result…'
            : phase === 'ko'
              ? 'A fighter is out of HP. Settling the duel on-chain, this can take a minute.'
              : 'Revealing positions and settling the duel on-chain. This can take a minute.'}
        </p>
        <div className="arena-settling-bar" role="progressbar" aria-label="Settling the duel">
          <i data-done={phase === 'over'} />
        </div>
      </div>
    </div>
  );
}
