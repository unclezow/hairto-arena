import type { ReactNode } from 'react';
import './play.css';

export function PlayIcon({
  name,
}: {
  name: 'lobby' | 'leaderboard' | 'store' | 'history' | 'back';
}) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'lobby' ? (
        <>
          <path d="m4 3 14 15m2-15L6 17M3 14l7 7m4-18 7 7M3 21l5-5m13 5-5-5" />
        </>
      ) : name === 'leaderboard' ? (
        <>
          <path d="M8 3h8v6a4 4 0 0 1-8 0V3Zm4 10v6m-4 2h8M8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4" />
        </>
      ) : name === 'store' ? (
        <>
          <path d="M4 9h16l-1 12H5L4 9Zm4 0V7a4 4 0 0 1 8 0v2m-7 5h6" />
          <path d="M3 9h18" />
        </>
      ) : name === 'history' ? (
        <>
          <path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7" />
          <path d="M12 7v5l3 2" />
        </>
      ) : (
        <path d="M20 12H4m6-6-6 6 6 6" />
      )}
    </svg>
  );
}

export function PlayShell({ children }: { children: ReactNode }) {
  return <div className="play-shell play-hub-shell">{children}</div>;
}
