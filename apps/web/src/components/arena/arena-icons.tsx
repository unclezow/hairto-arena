import type { CSSProperties } from 'react';

export function ArenaIcon({
  name,
  size = 18,
  style,
}: {
  name: 'arrow' | 'back' | 'play' | 'pause' | 'reset' | 'expand' | 'swords' | 'mouse';
  size?: number;
  style?: CSSProperties;
}) {
  const paths = {
    arrow: (
      <>
        <path d="M4 12h15m-6-6 6 6-6 6" />
      </>
    ),
    back: (
      <>
        <path d="M20 12H5m6-6-6 6 6 6" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7Z" />,
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    reset: (
      <>
        <path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" />
      </>
    ),
    expand: (
      <>
        <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
      </>
    ),
    swords: (
      <>
        <path d="m4 3 15 15m-2-2-3 3m3-16L4 16m1-11 1 4m13-4-1 4M3 21l5-5m13 5-5-5M3 14l7 7m4-18 7 7" />
      </>
    ),
    mouse: (
      <>
        <rect x="6" y="2" width="12" height="20" rx="6" />
        <path d="M12 6v4" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {paths[name]}
    </svg>
  );
}

export function ArenaWordmark() {
  return (
    <span className="arena-wordmark">
      <span className="arena-brand-symbol">
        <ArenaIcon name="swords" size={20} />
      </span>
      Hairto Arena<span className="arena-brand-dot">.</span>
    </span>
  );
}
