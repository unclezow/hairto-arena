'use client';

import Link from 'next/link';
import { ArenaIcon } from './arena-icons';
import './arena-loading-screen.css';

export function ArenaLoadingScreen({ failed = false }: { failed?: boolean }) {
  return (
    <div
      className="arena-entry-loading"
      role={failed ? 'alert' : 'status'}
      aria-live="polite"
      aria-busy={!failed}
    >
      <div className="arena-entry-loading-grain" aria-hidden="true" />
      <div className="arena-entry-loading-content">
        <span className="arena-entry-loading-brand">HAIRTO ARENA</span>
        <div className="arena-entry-loading-crest" aria-hidden="true">
          <span />
          <ArenaIcon name="swords" size={43} />
          <span />
        </div>
        <p className="arena-entry-loading-eyebrow">THE FLOATING GROUNDS</p>
        <h2>{failed ? 'The gates are closed.' : 'Preparing your arena'}</h2>
        <p className="arena-entry-loading-description">
          {failed
            ? 'Arena belum bisa dimuat. Coba muat ulang halaman.'
            : 'Gathering the fighters. Awakening the grounds.'}
        </p>
        {!failed && (
          <>
            <div className="arena-entry-loading-track" aria-hidden="true">
              <span />
            </div>
            <span className="arena-entry-loading-detail">
              FIGHTERS <i>◆</i> TERRAIN <i>◆</i> EFFECTS
            </span>
          </>
        )}
        {failed && (
          <button
            className="arena-entry-loading-retry"
            type="button"
            onClick={() => window.location.reload()}
          >
            Muat ulang arena ↗
          </button>
        )}
      </div>
      <Link href="/play/lobby" className="arena-entry-loading-exit">
        <ArenaIcon name="back" size={14} />
        Back to lobby
      </Link>
      <span className="arena-entry-loading-bottom">YOUR NEXT MOVE STARTS HERE.</span>
    </div>
  );
}
