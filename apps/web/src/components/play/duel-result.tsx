'use client';

import { DUEL, characterMetadata } from '@hairto-arena/shared';
import dynamic from 'next/dynamic';
import { FighterAvatar } from './play-assets';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDuelOnchain, type OnchainKind } from '@/hooks/use-duel-onchain';
import { api, ApiError } from '@/lib/api';
import { takeResultFromArena } from '@/lib/duel-storage';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { useSeedAudit } from '@/hooks/use-seed-audit';
import { explorerAddress, explorerTx, shortHash } from '@/lib/explorer';
import './duel-result.css';

const ResultFighter = dynamic(() => import('./lobby-fighter'), {
  ssr: false,
  loading: () => (
    <div className="dr-model-loading">
      <FighterAvatar />
    </div>
  ),
});
const LOBBY = '/play/lobby';

/** If a client-side navigation has not landed after a moment (a stalled route fetch), load the page outright. */
function loadIfStuck(path: string) {
  setTimeout(() => {
    if (window.location.pathname !== path) window.location.assign(path);
  }, 2500);
}

const FIGHTER_TITLES: Record<number, string> = {
  0: 'The Sentinel',
  1: 'The Arcanist',
  2: 'The Shadowblade',
  3: 'The Nightstalker',
  4: 'The Berserker',
};
function ResultCrest() {
  return (
    <svg viewBox="0 0 100 110" fill="none" aria-hidden="true">
      <path
        d="m50 5 34 14v34c0 20-17 38-34 48C33 91 16 73 16 53V19Z"
        fill="#163e32"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="m50 13 27 11v29c0 16-13 31-27 41-14-10-27-25-27-41V24Z"
        stroke="currentColor"
        strokeOpacity=".3"
      />
      <path
        d="M32 31H21v10c0 12 8 17 18 17m29-27h11v10c0 12-8 17-18 17"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path d="M30 27h40l-4 20c-1 11-8 18-16 18s-15-7-16-18l-4-20Z" fill="currentColor" />
      <path d="M50 65v11m-8 0h16l7 8H35l7-8Z" stroke="currentColor" strokeWidth="4" />
      <path d="m50 34 3 7 8 1-6 5 1 8-6-4-6 4 1-8-6-5 8-1Z" fill="#31523b" />
      <path
        d="M10 67 4 53m9 22L3 67m16 18L7 80m83-13 6-14m-9 22 10-8M81 85l12-5"
        stroke="currentColor"
        strokeOpacity=".6"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface DuelView {
  status: 'CREATED' | 'ACTIVE' | 'FINISHED' | 'FORFEITED' | 'VOIDED';
  fighter: string;
  bot: { address: string; name?: string; level?: number };
  fighterCharacter?: number;
  botCharacter?: number;
  hp: { fighter: number; bot: number };
  winner: string | null;
  ko: boolean;
  pointsAwarded: number | null;
  counted: boolean | null;
  /** Points read from the chain while the indexer is behind: the result is complete without the seed audit. */
  pointsFromChain?: boolean;
  /** The status was read from the chain: the indexed duel (and so its replay) is not available yet. */
  statusFromChain?: boolean;
}

interface Replay {
  bot: { seed: string | null; seedHash: string | null; verification: { status: string } | null };
}

const TERMINAL = new Set(['FINISHED', 'FORFEITED', 'VOIDED']);

const STEP: Record<OnchainKind, string> = {
  created: 'Duel created',
  opened: 'Position opened',
  closed: 'Position closed',
  penalized: 'Penalty (never closed)',
  finished: 'Duel settled',
  forfeited: 'Forfeited',
  voided: 'Voided',
  seed_revealed: 'Bot seed revealed',
};

type Outcome = 'win' | 'loss' | 'draw' | 'void' | 'pending';

function outcomeOf(d: DuelView | undefined): Outcome {
  if (!d || !TERMINAL.has(d.status)) return 'pending';
  if (d.status === 'VOIDED') return 'void';
  if (d.winner === null) return 'draw';
  return d.winner === d.fighter ? 'win' : 'loss';
}

const BANNER: Record<Outcome, { title: string; note: string }> = {
  win: { title: 'VICTORY', note: 'You out-traded the bot.' },
  loss: { title: 'DEFEAT', note: 'The bot took this one.' },
  draw: { title: 'DRAW', note: 'Nobody landed the last hit.' },
  void: { title: 'VOIDED', note: 'Price trouble or an unfinished duel. No points.' },
  pending: { title: 'SETTLING', note: 'The chain is closing the duel…' },
};

/** A NEAR account linked to the configured explorer. */
function AddressLink({ address }: { address: string }) {
  const href = explorerAddress(address);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" title={address}>
      {shortHash(address)}
    </a>
  ) : (
    <code title={address}>{shortHash(address)}</code>
  );
}

function HpBar({ label, hp, team }: { label: string; hp: number; team: 'you' | 'bot' }) {
  const pct = Math.max(0, Math.min(100, (hp / DUEL.startingHp) * 100));
  return (
    <div className="dr-hp" data-team={team}>
      <div className="dr-hp-head">
        <span>{label}</span>
        <b>{hp} HP</b>
      </div>
      <div className="dr-hp-track">
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** The duel result in the lobby's look: outcome banner, HP, points, bot proof and the on-chain steps. */
export function DuelResult({ id }: { id: string }) {
  const router = useRouter();
  const { accountId: address, token } = useWalletSession();
  // The API reports 0 points until ScoreBoard records the result, which lands with the bot's seed reveal.
  const queryClient = useQueryClient();
  const duel = useQuery({
    queryKey: ['duel', id, address, token],
    queryFn: ({ signal }) => api<DuelView>(`/duels/${id}`, { signal }),
    enabled: !!token,
    retry: false,
    // Settlement lands a while after the round, then points and the seed; keep reading until they do.
    refetchInterval: (q) => {
      if (q.state.error instanceof ApiError && [401, 403, 404].includes(q.state.error.status))
        return false;
      const d = q.state.data;
      return !d ||
        !TERMINAL.has(d.status) ||
        !queryClient.getQueryData<Replay>(['duel', id, 'replay', address, token])?.bot.seed
        ? 3000
        : false;
    },
  });
  const d = duel.data;
  const terminal = !!d && TERMINAL.has(d.status);
  const replay = useQuery({
    queryKey: ['duel', id, 'replay', address, token],
    queryFn: ({ signal }) => api<Replay>(`/duels/${id}/replay`, { signal }),
    enabled: terminal && !d.statusFromChain && !!token,
    retry: false,
    refetchInterval: (q) =>
      q.state.error instanceof ApiError && [401, 403, 404].includes(q.state.error.status)
        ? false
        : q.state.data?.bot.seed
          ? false
          : 5000,
  });
  const seed = replay.data?.bot.seed;
  // The result is shown in one go: wait until the duel is settled and its points are recorded (they land with the
  // bot's seed reveal). After a minute and a half show what there is instead of waiting forever.
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setGaveUp(true), 90_000);
    return () => clearTimeout(timer);
  }, []);
  const settled = terminal && (d.status === 'VOIDED' || !!seed || !!d.pointsFromChain);
  const settling = !duel.isError && !settled && !gaveUp;
  const onchain = useDuelOnchain(id, settling);

  const outcome = outcomeOf(d);
  const banner = BANNER[outcome];
  const points =
    d?.pointsAwarded == null || (d.status === 'FINISHED' && !seed && !d.pointsFromChain)
      ? 'recording…'
      : d.counted === false
        ? 'not counted'
        : `${d.pointsAwarded > 0 ? '+' : ''}${d.pointsAwarded}`;
  const contract = onchain.data ? explorerAddress(onchain.data.arena) : null;
  const revealTx = onchain.data?.txs.find((t) => t.kind === 'seed_revealed');
  const seedHref = revealTx ? explorerTx(revealTx.txHash) : null;
  const createdTx = onchain.data?.txs.find((t) => t.kind === 'created')?.txHash ?? null;
  const seedAudit = useSeedAudit({
    createdTx,
    fighter: d?.fighter ?? null,
    seed: seed ?? null,
    seedHash: replay.data?.bot.seedHash ?? null,
  });

  const player = characterMetadata(d?.fighterCharacter ?? 0);
  const opponent = characterMetadata(d?.botCharacter ?? 4);
  const waiting = outcome === 'pending';
  const privateDuel = duel.error instanceof ApiError && duel.error.status === 403;
  const needsSignIn = !token || (duel.error instanceof ApiError && duel.error.status === 401);
  const displayTitle = needsSignIn
    ? 'SIGN IN REQUIRED'
    : privateDuel
      ? 'PRIVATE DUEL'
      : duel.isError
        ? 'SIGNAL LOST'
        : waiting
          ? 'AWAITING RESULT'
          : banner.title;
  const portraits = [
    {
      side: 'you' as const,
      character: player,
      title: FIGHTER_TITLES[player.id] ?? player.name,
      address: d?.fighter,
      hp: d?.hp.fighter,
      won: outcome === 'win',
      tag: 'P1 · YOU',
    },
    {
      side: 'bot' as const,
      character: opponent,
      title: FIGHTER_TITLES[opponent.id] ?? opponent.name,
      address: d?.bot.address,
      hp: d?.hp.bot,
      won: outcome === 'loss',
      tag: 'CPU · OPPONENT',
    },
  ];

  return (
    <main className="duel-result" data-outcome={outcome}>
      <div className="duel-result-backdrop" aria-hidden="true" />
      <header className="duel-result-header">
        <Link href="/play/lobby" className="duel-result-brand">
          HAIRTO <span>ARENA</span>
        </Link>
        <span className="duel-result-tag">
          SOLO DUEL <i /> #{id}
        </span>
        <button
          type="button"
          className="dr-top-exit"
          onClick={() => {
            // Straight after a duel the previous page is the finished arena, so "back" means the lobby.
            if (takeResultFromArena(id) || window.history.length <= 1) {
              router.push(LOBBY);
              loadIfStuck(LOBBY);
            } else {
              router.back();
            }
          }}
        >
          ← BACK
        </button>
      </header>
      <section className="dr-panel" aria-label="Duel results">
        <div className="dr-result-heading" role="status" aria-live="polite">
          <div className="dr-crest">
            <ResultCrest />
          </div>
          <p className="dr-kicker">
            {needsSignIn || privateDuel
              ? 'FIGHTER ACCESS ONLY'
              : duel.isError
                ? 'CONNECTION INTERRUPTED'
                : waiting
                  ? 'THE FINAL BELL'
                  : 'DUEL COMPLETE'}
          </p>
          <h1 className="dr-banner">{displayTitle}</h1>
          <p className="dr-note">
            {needsSignIn
              ? 'Return to the lobby and sign in with the wallet that played this duel.'
              : privateDuel
                ? 'Only the fighter who played this duel can view its result.'
                : duel.isError
                  ? 'The result could not be loaded. You can retry below.'
                  : waiting
                    ? 'Your battle is over. The final verdict is being recorded.'
                    : banner.note}
            {d?.ko && ' K.O.!'}
          </p>
        </div>
        <div className="dr-overview">
          <div className="dr-matchup">
            {portraits.map((fighter) => (
              <article
                key={fighter.side}
                className="dr-fighter"
                data-team={fighter.side}
                data-winner={fighter.won}
              >
                <div className="dr-fighter-top">
                  <span>{fighter.tag}</span>
                  {fighter.won ? <strong>♛ WINNER</strong> : <span>{fighter.character.name}</span>}
                </div>
                <div className="dr-fighter-art">
                  <div className="dr-fighter-halo" aria-hidden="true" />
                  <div className="dr-model" key={fighter.character.model}>
                    <ResultFighter
                      faceForward
                      modelPath={
                        fighter.character.modelAvailable
                          ? fighter.character.model
                          : '/arena/characters/Knight.glb'
                      }
                      mood={
                        fighter.won
                          ? 'victory'
                          : outcome === 'win' || outcome === 'loss'
                            ? 'sad'
                            : 'idle'
                      }
                      label={`${fighter.title}, ${fighter.character.name}${fighter.won ? ', celebrating victory' : outcome === 'win' || outcome === 'loss' ? ', sitting with head bowed after defeat' : ''}`}
                    />
                  </div>
                </div>
                <div className="dr-fighter-identity">
                  <span>{fighter.character.name}</span>
                  <h2>{fighter.title}</h2>
                  <div className="dr-fighter-address">
                    {fighter.address ? (
                      <AddressLink address={fighter.address} />
                    ) : (
                      <span>Loading fighter…</span>
                    )}
                  </div>
                </div>
                {fighter.hp !== undefined ? (
                  <HpBar label="REMAINING HEALTH" hp={fighter.hp} team={fighter.side} />
                ) : (
                  <p className="dr-fighter-loading">Fetching battle record…</p>
                )}
              </article>
            ))}
            <div className="dr-match-seal" aria-hidden="true">
              <span>VS</span>
              <small>ROUND 01</small>
            </div>
          </div>
          {(waiting || (settling && !duel.isError)) && (
            <div className="dr-settlement-status" role="status">
              <span className="dr-status-orb" aria-hidden="true" />
              <div>
                <strong>{terminal ? 'RECORDING YOUR POINTS' : 'SETTLING THE DUEL'}</strong>
                <p>
                  {gaveUp
                    ? 'Taking longer than expected. This page keeps checking for the final result.'
                    : 'Waiting for confirmation. Your result will update automatically.'}
                </p>
              </div>
              <span className="dr-status-dots" aria-hidden="true">
                ···
              </span>
            </div>
          )}
          <dl className="dr-stats">
            <div className="dr-points">
              <span className="dr-stat-symbol" aria-hidden="true">
                ✦
              </span>
              <div>
                <dt>SEASON POINTS</dt>
                <dd>
                  {waiting || !settled ? <span className="dr-stat-pending">Pending</span> : points}
                </dd>
              </div>
              <span className="dr-stat-footnote">
                {d?.counted === false ? 'Practice duel' : 'This duel'}
              </span>
            </div>
            <div className="dr-proof-stat">
              <span className="dr-stat-symbol" aria-hidden="true">
                ◇
              </span>
              <div>
                <dt>FAIR PLAY PROOF</dt>
                <dd>
                  {seed ? (
                    seedHref ? (
                      <a href={seedHref} target="_blank" rel="noreferrer" title={seed}>
                        {shortHash(seed)} ↗
                      </a>
                    ) : (
                      <code title={seed}>{shortHash(seed)}</code>
                    )
                  ) : (
                    <span className="dr-stat-pending">Awaiting reveal</span>
                  )}
                </dd>
              </div>
              {replay.data?.bot.verification && (
                <span className="dr-badge" data-status={replay.data.bot.verification.status}>
                  {replay.data.bot.verification.status}
                </span>
              )}
              {seedAudit && (
                <span className="dr-badge" data-status={seedAudit} title="Seed hash recomputed in your browser">
                  {seedAudit === 'match' ? 'seed match' : 'seed mismatch'}
                </span>
              )}
            </div>
          </dl>
        </div>
        <aside className="dr-chain" aria-label="Duel transaction history">
          <header className="dr-chain-heading">
            <span>DUEL RECORD</span>
            <span>{onchain.data?.txs.length ?? 0} TRANSACTIONS</span>
          </header>
          <div className="dr-chain-content">
            {onchain.data && (
              <p className="dr-contract">
                Arena{' '}
                {contract ? (
                  <a href={contract} target="_blank" rel="noreferrer">
                    {shortHash(onchain.data.arena)}
                  </a>
                ) : (
                  <code>{shortHash(onchain.data.arena)}</code>
                )}
              </p>
            )}
            <ol>
              {onchain.isError && (
                <li className="dr-empty" role="status">
                  Could not load transaction proof.
                  {terminal ? ' The duel result is already on-chain. ' : ' '}
                  <button type="button" onClick={() => void onchain.refetch()}>
                    Retry
                  </button>
                </li>
              )}
              {!onchain.isError && (onchain.data?.txs ?? []).length === 0 && (
                <li className="dr-empty">Syncing transaction history…</li>
              )}
              {(onchain.data?.txs ?? []).map((s) => {
                const href = explorerTx(s.txHash);
                const hit = s.opponentDelta ? `hit ${-s.opponentDelta} HP` : '';
                const took = s.selfDelta ? `took ${-s.selfDelta} HP` : '';
                const extra = [s.dir, hit, took].filter(Boolean).join(' · ');
                return (
                  <li key={`${s.txHash}-${s.kind}-${s.side}`} data-side={s.side ?? 'duel'}>
                    <span>
                      {STEP[s.kind]}
                      {s.side ? ` · ${s.side === 'bot' ? 'Bot' : 'You'}` : ''}
                      {extra && <em>{extra}</em>}
                    </span>
                    {href ? (
                      <a href={href} target="_blank" rel="noreferrer" title={s.txHash}>
                        {shortHash(s.txHash)}
                      </a>
                    ) : (
                      <code title={s.txHash}>{shortHash(s.txHash)}</code>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </aside>

        <div className="dr-actions">
          <Link href={LOBBY} className="dr-back" onClick={() => loadIfStuck(LOBBY)}>
            <span>←</span>
            <strong>BACK TO LOBBY</strong>
          </Link>
          {(duel.isError || (gaveUp && !settled)) && (
            <button
              type="button"
              className="dr-refresh"
              onClick={() => {
                void duel.refetch();
                void onchain.refetch();
                if (terminal) void replay.refetch();
              }}
            >
              ↻ REFRESH RESULT
            </button>
          )}
          <p>
            {waiting
              ? 'You can return to the lobby while the result is recorded.'
              : 'Every duel is a new beginning.'}
          </p>
        </div>
      </section>
    </main>
  );
}
