import { useId } from 'react';

/** Original SVG game frames and portraits, kept sharp at every display size. */
export function GamePlaque({ title, subtitle }: { title: string; subtitle?: string }) {
  const id = useId().replaceAll(':', '');
  return (
    <header className="game-plaque">
      <svg viewBox="0 0 760 106" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-metal`} x2="0" y2="1">
            <stop stopColor="#f2dfaa" />
            <stop offset=".18" stopColor="#9d8b59" />
            <stop offset=".5" stopColor="#d0b779" />
            <stop offset=".55" stopColor="#73603e" />
            <stop offset="1" stopColor="#c3aa72" />
          </linearGradient>
          <linearGradient id={`${id}-stone`} x2="0" y2="1">
            <stop stopColor="#3e513c" />
            <stop offset=".48" stopColor="#1b3027" />
            <stop offset="1" stopColor="#17271f" />
          </linearGradient>
        </defs>
        <path
          d="M22 5H738L756 23V83L738 101H22L4 83V23Z"
          fill={`url(#${id}-metal)`}
          stroke="#e9d29c"
          strokeWidth="2"
        />
        <path
          d="M27 13H733L747 27V79L733 93H27L13 79V27Z"
          fill="#293628"
          stroke="#615b3e"
          strokeWidth="4"
        />
        <path
          d="M71 20H689L703 33V73L689 86H71L57 73V33Z"
          fill={`url(#${id}-stone)`}
          stroke="#a39465"
          strokeWidth="2"
        />
        <path d="M82 26H678M82 81H678" stroke="#e0cf9a" strokeOpacity=".16" />
        {[
          [29, 28],
          [731, 28],
          [29, 78],
          [731, 78],
        ].map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <path
              d={`m${x} ${y! - 10} 9 5v10l-9 5-9-5V${y! - 5}Z`}
              fill="#777052"
              stroke="#d8c392"
              strokeWidth="2"
            />
            <circle cx={x} cy={y} r="4" fill="#18281f" stroke="#a19265" />
            <path d={`m${x! - 3} ${y! + 3} 6-6`} stroke="#6f7855" />
          </g>
        ))}
      </svg>
      <div>
        <h1>{title}</h1>
        {subtitle && <span>{subtitle}</span>}
      </div>
    </header>
  );
}

export function Trophy({ metal = 'gold' }: { metal?: 'gold' | 'silver' | 'bronze' }) {
  const id = useId().replaceAll(':', '');
  const colors =
    metal === 'gold'
      ? ['#fff0b8', '#c7a75d', '#7c6035']
      : metal === 'silver'
        ? ['#edf1ea', '#a3b5b6', '#536a71']
        : ['#f4d1a3', '#b78a5d', '#765035'];
  return (
    <svg viewBox="0 0 80 86" fill="none" aria-hidden="true">
      <defs>
        <linearGradient
          id={`${id}-cup`}
          x1="12"
          y1="6"
          x2="62"
          y2="69"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor={colors[0]} />
          <stop offset=".45" stopColor={colors[1]} />
          <stop offset="1" stopColor={colors[2]} />
        </linearGradient>
      </defs>
      <ellipse cx="40" cy="78" rx="25" ry="5" fill="#0b1714" opacity=".5" />
      <path
        d="M22 14H9v13c0 13 9 19 21 18m28-31h13v13c0 13-9 19-21 18"
        stroke={colors[1]}
        strokeWidth="6"
      />
      <path
        d="m18 10 4 25c2 12 10 20 18 20s16-8 18-20l4-25H18Z"
        fill={`url(#${id}-cup)`}
        stroke={colors[0]}
        strokeWidth="1.2"
      />
      <ellipse cx="40" cy="11" rx="22" ry="5" fill={colors[2]} stroke={colors[0]} strokeWidth="2" />
      <ellipse cx="40" cy="10" rx="17" ry="2" fill="#16281f" opacity=".5" />
      <path
        d="M40 54v11m-7 2h14l8 9H25l8-9Z"
        fill={`url(#${id}-cup)`}
        stroke={colors[1]}
        strokeWidth="4"
      />
      <path d="m40 23 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1 3-7Z" fill="#fff1c0" opacity=".65" />
      <path
        d="M26 20c0 11 2 19 7 24"
        stroke="#fff4c4"
        strokeOpacity=".45"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

const TINTS = [
  '#a1c797',
  '#9fc6db',
  '#d7b297',
  '#b3a5d5',
  '#cf9eab',
  '#82bbaf',
  '#d8bd79',
  '#a3b582',
];
export function FighterAvatar({
  seed = 0,
  variant = 'knight',
}: {
  seed?: number;
  variant?: 'knight' | 'raider';
}) {
  const id = useId().replaceAll(':', '');
  const tint = TINTS[seed % TINTS.length]!;
  return (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-bg`}>
          <stop stopColor={tint} />
          <stop offset="1" stopColor="#1c382e" />
        </radialGradient>
        <linearGradient
          id={`${id}-helm`}
          x1="20"
          y1="10"
          x2="60"
          y2="70"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#e5e8d8" />
          <stop offset=".45" stopColor={tint} />
          <stop offset="1" stopColor="#465c4c" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx="40" cy="40" r="37" />
        </clipPath>
      </defs>
      <circle cx="40" cy="40" r="38" fill="#14271e" stroke={tint} strokeWidth="2" />
      <g clipPath={`url(#${id}-clip)`}>
        <circle cx="40" cy="40" r="36" fill={`url(#${id}-bg)`} />
        <path d="M0 60 60 0m-40 85 60-60" stroke="#fff5c3" strokeOpacity=".08" strokeWidth="10" />
        <path d="M13 82V66l17-12h20l17 12v16H13Z" fill="#2e4837" />
        <path d="m21 70 19-8 19 8M40 65v15" stroke={tint} strokeOpacity=".5" strokeWidth="2" />
        {variant === 'knight' ? (
          <>
            <path
              d="M19 43V28c0-13 9-21 21-21s21 8 21 21v15L51 61H30L19 43Z"
              fill={`url(#${id}-helm)`}
              stroke="#e4dfb6"
              strokeWidth="1"
            />
            <path d="m40 9 7 22-7 6-7-6 7-22Z" fill="#f2e8bf" opacity=".45" />
            <path d="m22 32 18 6 18-6-3 15-15 7-15-7-3-15Z" fill="#1e382f" />
            <path d="m28 39 8 2m8 0 8-2" stroke="#e9dc9c" strokeWidth="2" strokeLinecap="round" />
            <path d="m22 49 18 7 18-7-7 15H30l-8-15Z" fill={`url(#${id}-helm)`} />
          </>
        ) : (
          <>
            <path
              d="M20 31c0-14 8-23 20-23s20 9 20 23v14c0 13-8 20-20 20s-20-7-20-20V31Z"
              fill="#d9bb91"
            />
            <path d="M17 31V19L8 12l6 22 10 5m39-8V19l9-7-6 22-10 5" fill={tint} stroke="#e4d5a7" />
            <path d="M19 30c2-18 10-24 21-24s20 6 21 24l-13-5-8 7-8-7-13 5Z" fill="#526348" />
            <path d="M24 47c3 18 7 23 16 23s15-8 16-23l-10 7-6-5-6 5-10-7Z" fill="#6e7552" />
            <path d="M28 36v5m24-5v5" stroke="#22392d" strokeWidth="4" strokeLinecap="round" />
            <path d="m35 46 5 2 5-2" stroke="#b6916e" strokeWidth="2" />
          </>
        )}
      </g>
      <circle cx="40" cy="40" r="34" stroke="#e3d6a0" strokeOpacity=".22" />
    </svg>
  );
}
