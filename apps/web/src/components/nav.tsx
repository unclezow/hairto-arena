'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/lobby', label: 'Lobby' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/economy', label: 'Economy' },
  { href: '/backer', label: 'Backer' },
  { href: '/claim', label: 'Claim' },
  { href: '/admin', label: 'Admin' },
] as const;

export function Nav() {
  const pathname = usePathname();
  const isLanding = pathname === '/';
  const links = isLanding ? [{ href: '/play', label: 'Play' }] : LINKS;
  if (
    isLanding ||
    pathname === '/sign' ||
    pathname === '/arena' ||
    pathname === '/lobby' ||
    pathname === '/play' ||
    pathname.startsWith('/duel/') ||
    pathname.startsWith('/play/')
  )
    return null;
  return (
    <header className="border-b border-white/10">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-mono text-lg font-bold tracking-tight">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-mark.svg" alt="" width={28} height={28} />
          Hairto Arena
        </Link>
        <ul className="flex flex-wrap items-center gap-4 text-sm text-white/70">
          {links.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className={
                  isLanding
                    ? 'rounded-md bg-white px-4 py-2 font-semibold text-black transition-colors hover:bg-white/85'
                    : 'hover:text-white'
                }
              >
                {l.label}
              </Link>
            </li>
          ))}
          {!isLanding && (
            <li>
              <Link
                href="/play/lobby?connect=1"
                className="rounded-md bg-white px-3 py-1.5 font-medium text-black"
              >
                Sign in
              </Link>
            </li>
          )}
        </ul>
      </nav>
    </header>
  );
}
