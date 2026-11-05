'use client';

import Link from 'next/link';
import { useMatchHistory } from '@/hooks/use-match-history';
import { shortAddress } from '@/hooks/use-lobby-data';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { arenaOutcome } from '../arena/arena-outcome';
import { PlayIcon } from './play-shell';
import './history.css';

const OUTCOMES = { win: 'VICTORY', loss: 'DEFEAT', draw: 'DRAW', void: 'VOIDED' };

export default function HistoryContent() {
  const history = useMatchHistory();
  const { accountId: address } = useWalletSession();
  const matches = history.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="mh" aria-label="Your match history">
      <header className="mh-header">
        <div>
          <span>HAIRTO ARENA / YOUR BATTLE RECORD</span>
          <h1>
            HISTORY MATCH<span>.</span>
          </h1>
          <p>Every duel. Every comeback. Your journey in the arena.</p>
        </div>
        <div className="mh-seal" aria-hidden="true">
          <PlayIcon name="history" />
        </div>
      </header>
      <div className="mh-toolbar">
        <span>{address ? shortAddress(address) : 'YOUR FIGHTER'} · NEWEST FIRST</span>
        <button type="button" disabled={history.isFetching} onClick={() => void history.refetch()}>
          {history.isFetching ? 'REFRESHING…' : 'REFRESH ↻'}
        </button>
      </div>
      {history.isPending ? (
        <div className="mh-empty" role="status">
          <h2>Opening your battle journal…</h2>
        </div>
      ) : history.isError && matches.length === 0 ? (
        <div className="mh-empty" role="alert">
          <h2>Your journal could not be loaded.</h2>
          <p>Try refreshing to retrieve your matches.</p>
          <button type="button" onClick={() => void history.refetch()}>
            TRY AGAIN ↻
          </button>
        </div>
      ) : matches.length === 0 ? (
        <div className="mh-empty">
          <PlayIcon name="history" />
          <h2>Your story starts with a duel.</h2>
          <p>Play your first battle to leave your mark here.</p>
        </div>
      ) : (
        <ol className="mh-list">
          {matches.map((match) => {
            const outcome = arenaOutcome(match.status.toLowerCase(), match.fighter, match.winner);
            const settled = outcome !== null;
            const points = match.pointsAwarded ?? 0;
            return (
              <li key={match.id} className="mh-match" data-outcome={outcome ?? 'pending'}>
                <div className="mh-result">
                  <span>DUEL #{match.id}</span>
                  <strong>{outcome ? OUTCOMES[outcome] : 'IN PROGRESS'}</strong>
                  {match.status === 'FORFEITED' && <small>FORFEITED</small>}
                </div>
                <div className="mh-opponent">
                  <strong>VS {match.bot.name}</strong>
                  <span>
                    LEVEL {match.bot.level} · MARKET #{match.assetId}
                  </span>
                  {match.startAt && (
                    <time dateTime={match.startAt}>
                      {new Date(match.startAt).toLocaleString('en-GB', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </time>
                  )}
                </div>
                <div className="mh-points" data-positive={points > 0} data-negative={points < 0}>
                  <strong>
                    {outcome === 'void' || !settled || match.counted === null
                      ? '—'
                      : `${points > 0 ? '+' : ''}${points}`}
                  </strong>
                  <span>
                    {outcome === 'void'
                      ? 'NOT COUNTED'
                      : !settled || match.counted === null
                        ? 'PENDING'
                        : 'POINTS'}
                  </span>
                </div>
                <Link
                  className="mh-detail"
                  href={settled ? `/duel/${match.id}/result` : `/arena?duel=${match.id}`}
                  prefetch={false}
                >
                  {settled ? 'DETAILS' : 'RESUME'} <span aria-hidden="true">↗</span>
                  <span className="sr-only"> for duel #{match.id}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      {history.isError && matches.length > 0 && (
        <p role="alert">Could not update your history. Refresh to try again.</p>
      )}
      {history.hasNextPage && (
        <button
          className="mh-more"
          type="button"
          disabled={history.isFetching}
          onClick={() => void history.fetchNextPage()}
        >
          {history.isFetchingNextPage ? 'LOADING…' : 'LOAD MORE MATCHES ↓'}
        </button>
      )}
      <footer className="mh-note">
        Results appear after settlement. Voided matches do not affect your season score.
      </footer>
    </section>
  );
}
