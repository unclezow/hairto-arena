import type { AttackKind } from './arena-combat';

/** Original engraved symbols, matching the stone-and-gold arena controls. */
export function AttackIcon({ kind, size = 26 }: { kind: AttackKind | 'lab'; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'lab' && (
        <>
          <path d="m8 6 24 25M7 5l6 2-4 4-2-6Zm20 22-5 5m6-26L8 30m25-25-6 2 4 4 2-6ZM6 34l8-8m20 8-8-8" />
          <path d="m20 3 2 4-2 4-2-4Zm0 26 2 4-2 4-2-4Z" opacity=".6" />
        </>
      )}
      {kind === 'basic' && (
        <>
          <path d="M27 5 11 23l5 5L34 12l1-9-8 2Zm-17 17 9 9M7 26l7 7m-8 2 6-6M15 23 29 9" />
          <path d="M5 13h8m-3-5v4M25 32h9" opacity=".5" />
        </>
      )}
      {kind === 'medium' && (
        <>
          <path d="M30 5C8 5 2 23 10 33c-2-12 6-22 20-28Z" />
          <path d="M29 10C18 17 16 25 17 33M23 29l8-7-2 8 5 1-12 6 1-8Z" />
          <path d="m9 5 1 4 4 1-4 1-1 4-1-4-4-1 4-1 1-4Z" opacity=".65" />
        </>
      )}
      {kind === 'ultimate' && (
        <>
          <circle cx="20" cy="20" r="14" strokeDasharray="14 4 3 4" />
          <path d="m20 3 4 12 13 5-13 4-4 13-4-13-13-4 13-5 4-12Z" />
          <path d="m20 12 3 8-3 8-3-8 3-8Zm-9-1 4 4m10 10 4 4m0-18-4 4M15 25l-4 4" />
        </>
      )}
    </svg>
  );
}
