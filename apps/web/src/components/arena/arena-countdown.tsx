'use client';

import './arena-countdown.css';

/** The last ten seconds of a round, as a big number in the middle of the arena. Never blocks a click. */
export function ArenaCountdown({ seconds }: { seconds: number }) {
  if (seconds <= 0) return null;
  return (
    <div className="arena-countdown" aria-hidden="true">
      {/* Keyed by the second so the pop animation replays on every tick. */}
      <b key={seconds} data-last={seconds <= 3}>
        {seconds}
      </b>
    </div>
  );
}
