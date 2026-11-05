'use client';

import { useId, useRef } from 'react';

export type MenuLaunch = {
  panel: 'leaderboard' | 'store' | 'history';
  x: number;
  y: number;
  width: number;
  height: number;
};

/** The projectile finishes first; only its arrival may open the native dialog. */
export function MenuLightFlight({
  launch,
  onArrive,
}: {
  launch: MenuLaunch;
  onArrive: () => void;
}) {
  const id = useId().replaceAll(':', '');
  const delivered = useRef(false);
  const endX = launch.width / 2;
  const endY = launch.height / 2;
  const path = `M${launch.x} ${launch.y} Q${(launch.x + endX) / 2} ${Math.min(launch.y, endY) - 65} ${endX} ${endY}`;
  return (
    <div
      className="hub-menu-light-flight"
      aria-hidden="true"
      onAnimationEnd={(event) => {
        if (
          event.target !== event.currentTarget ||
          event.animationName !== 'hub-menu-flight-clock' ||
          delivered.current
        )
          return;
        delivered.current = true;
        event.currentTarget.dataset.arrived = 'true';
        onArrive();
      }}
    >
      <svg viewBox={`0 0 ${launch.width} ${launch.height}`} preserveAspectRatio="none" fill="none">
        <defs>
          <filter id={`${id}-glow`} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3" result="light" />
            <feMerge>
              <feMergeNode in="light" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id={`${id}-orb`}>
            <stop stopColor="#fff9d6" />
            <stop offset=".28" stopColor="#f9e3a1" />
            <stop offset=".6" stopColor="#d0b375" stopOpacity=".55" />
            <stop offset="1" stopColor="#d0b375" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle
          className="hub-menu-source-flash"
          cx={launch.x}
          cy={launch.y}
          r="22"
          stroke="#e8d198"
          strokeWidth="1.5"
        />
        <path
          d={path}
          pathLength="1"
          stroke="#d5b96f"
          strokeWidth="9"
          className="hub-menu-flight-trail hub-menu-flight-haze"
        />
        <path
          d={path}
          pathLength="1"
          stroke="#f5e0a5"
          strokeWidth="2"
          className="hub-menu-flight-trail"
        />
        <g className="hub-menu-flight-orb">
          <animateMotion
            dur=".48s"
            path={path}
            calcMode="spline"
            keyTimes="0;1"
            keySplines=".4 0 .6 1"
            fill="freeze"
          />
          <circle r="24" fill={`url(#${id}-orb)`} />
          <circle r="4" fill="#fff7ce" filter={`url(#${id}-glow)`} />
          <path d="M-10 0h20M0-10v20" stroke="#fff4c2" strokeWidth="1.3" />
        </g>
        <g className="hub-menu-flight-impact" style={{ transformOrigin: `${endX}px ${endY}px` }}>
          <circle cx={endX} cy={endY} r="23" fill={`url(#${id}-orb)`} />
          <circle cx={endX} cy={endY} r="17" stroke="#f2dca2" strokeWidth="1" />
          <path
            d={`M${endX - 32} ${endY}h64M${endX} ${endY - 25}v50`}
            stroke="#ffe9b2"
            strokeWidth="1.4"
            filter={`url(#${id}-glow)`}
          />
        </g>
      </svg>
    </div>
  );
}
