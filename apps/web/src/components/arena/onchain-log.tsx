'use client';

import { useEffect, useRef, useState } from 'react';
import { useDuelOnchain, type OnchainKind, type OnchainStep } from '@/hooks/use-duel-onchain';
import { explorerTx, shortHash } from '@/lib/explorer';
import './onchain-log.css';

const LABEL: Record<OnchainKind, string> = {
  created: 'CREATE',
  opened: 'OPEN',
  closed: 'CLOSE',
  penalized: 'PENALTY',
  finished: 'SETTLE',
  forfeited: 'FORFEIT',
  voided: 'VOID',
  seed_revealed: 'SEED',
};

/** How long a toast stays, and how many show at once. */
const TOAST_MS = 5000;
const MAX_TOASTS = 4;
/** On first load, steps newer than this still get a toast. */
const RECENT_MS = 10_000;

const who = (s: OnchainStep) => (s.side === 'fighter' ? 'YOU' : s.side === 'bot' ? 'BOT' : 'DUEL');
const keyOf = (s: OnchainStep) => `${s.txHash}-${s.kind}-${s.side}`;

/** The HP a close or penalty took, from the point of view of whoever acted. */
function detail(s: OnchainStep): string | null {
  if (s.kind !== 'closed' && s.kind !== 'penalized') return null;
  const parts: string[] = [];
  if (s.dir) parts.push(s.dir);
  if (s.pnlPpm !== null)
    parts.push(`${s.pnlPpm >= 0 ? '+' : ''}${(s.pnlPpm / 100).toFixed(2)} bps`);
  const hit = s.opponentDelta ?? 0;
  const recoil = s.selfDelta ?? 0;
  if (hit < 0) parts.push(`HIT ${-hit} HP`);
  if (recoil < 0) parts.push(`TOOK ${-recoil} HP`);
  if (hit === 0 && recoil === 0) parts.push('NO DAMAGE');
  return parts.join(' · ');
}

/** Each new on-chain step slides in as a short-lived, see-through toast, so nothing piles up over the arena. */
export function OnchainLog({ duelId, live }: { duelId: string; live: boolean }) {
  const { data } = useDuelOnchain(duelId, live);
  const [toasts, setToasts] = useState<OnchainStep[]>([]);
  // Steps already on the chain when the screen opens (a reload mid-duel) are not announced again.
  const seen = useRef<Set<string> | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (!data) return;
    // Steps already on the chain when the screen opens are not announced, except the very recent ones: the bot
    // often opens before the arena has finished loading, and that open should not be missed.
    const known =
      seen.current ??
      new Set(data.txs.filter((s) => Date.now() - Date.parse(s.at) > RECENT_MS).map(keyOf));
    seen.current = known;
    const fresh = data.txs.filter((s) => !known.has(keyOf(s)));
    if (fresh.length === 0) return;
    for (const s of fresh) {
      known.add(keyOf(s));
      timers.current.push(
        window.setTimeout(
          () => setToasts((list) => list.filter((t) => keyOf(t) !== keyOf(s))),
          TOAST_MS,
        ),
      );
    }
    setToasts((list) => [...list, ...fresh].slice(-MAX_TOASTS));
  }, [data]);

  useEffect(
    () => () => {
      for (const id of timers.current) window.clearTimeout(id);
    },
    [],
  );

  return (
    <div className="onchain-toasts" aria-live="polite" aria-label="On-chain log">
      {toasts.map((s) => {
        const href = explorerTx(s.txHash);
        const text = detail(s);
        return (
          <div
            key={keyOf(s)}
            className="onchain-toast"
            data-kind={s.kind}
            data-side={s.side ?? 'duel'}
          >
            <div className="onchain-toast-line">
              <b>{LABEL[s.kind]}</b>
              <span>{who(s)}</span>
              {href ? (
                <a href={href} target="_blank" rel="noreferrer" title={s.txHash}>
                  {shortHash(s.txHash)}
                </a>
              ) : (
                <code title={s.txHash}>{shortHash(s.txHash)}</code>
              )}
            </div>
            {text && <div className="onchain-toast-detail">{text}</div>}
          </div>
        );
      })}
    </div>
  );
}
