'use client';

import Image from 'next/image';
import { useId, useState } from 'react';
import './leaderboard.css';
import { POT_SPLIT, PRIZE_CURVE_BPS, SCORE } from '@hairto-arena/shared';
import { Trophy } from '@/components/play/play-assets';
import { avatarSeed, shortAddress, useLeaderboard, useMyStanding } from '@/hooks/use-lobby-data';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { CharacterPortrait, characterPortrait } from './character-portrait';
import { useSelectedFighter } from './mock-fighters';

interface Row {
  name: string;
  address: string;
  score: number;
  duels: number;
  seed: number;
  demo?: boolean;
  rank?: number;
}

/**
 * Made-up fighters so the board can be seen with a crowd. Shown only while developing, or when
 * `NEXT_PUBLIC_DEMO_LEADERBOARD=true`, and always marked DEMO; never part of the real ranking.
 */
const SHOW_DEMO =
  process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_DEMO_LEADERBOARD === 'true';
const DEMO_FIGHTERS: Row[] = [
  [1840, 31],
  [1615, 28],
  [1390, 26],
  [1105, 22],
  [940, 19],
  [760, 17],
  [585, 14],
  [410, 12],
].map(([score, duels], i) => {
  const address = `demo-${i + 1}.testnet`;
  return {
    name: [
      'IRONVALE',
      'RUNEKEEPER',
      'WILDHEART',
      'ASHBLADE',
      'MOSSWALKER',
      'STORMCALLER',
      'NIGHTWARD',
      'OAKGUARD',
    ][i]!,
    address,
    score: score!,
    duels: duels!,
    seed: i,
    demo: true,
  };
});

/** Consecutive ranks with the same share collapse into one row: 1, 2, 3, 4, 5, 6–10, 11–20. */
const PRIZE_ROWS = PRIZE_CURVE_BPS.reduce<{ from: number; to: number; bps: number }[]>(
  (rows, bps, i) => {
    const last = rows.at(-1);
    if (last && last.bps === bps) last.to = i + 1;
    else rows.push({ from: i + 1, to: i + 1, bps });
    return rows;
  },
  [],
);

export default function LeaderboardContent() {
  const selectedFighter = useSelectedFighter();
  const [tab, setTab] = useState<'rankings' | 'rewards'>('rankings');
  const tabId = useId();
  const board = useLeaderboard();
  const standing = useMyStanding();
  const { accountId: address } = useWalletSession();
  const real: Row[] = (board.data?.items ?? []).map((r) => ({
    rank: r.rank,
    name: shortAddress(r.address),
    address: r.address,
    score: r.points,
    duels: r.duels,
    seed: avatarSeed(r.address),
  }));
  const demo = SHOW_DEMO && !board.isPending && !board.isError && real.length === 0;
  const fighters = demo ? DEMO_FIGHTERS : real;
  const me = address ? standing.data : undefined;
  const myDuels = Math.min(SCORE.minDuelsForLeaderboard, me?.duels ?? 0);
  const myRank = me?.rank ?? null;
  const qualified = myDuels >= SCORE.minDuelsForLeaderboard;
  const formatScore = (score: number) =>
    score.toLocaleString('en-US', { maximumFractionDigits: 0 });
  const podium = [1, 0, 2].map((index) => ({ fighter: fighters[index], rank: index + 1 }));
  const isMe = (fighter: Row) =>
    !fighter.demo && !!address && fighter.address === address;

  const portraitId = (fighter: Row | undefined, fallback: number) =>
    fighter && isMe(fighter)
      ? selectedFighter.id
      : [0, 1, 4, 2, 3][(fighter?.seed ?? fallback) % 5]!;
  return (
    <section className="lb" aria-label="Season leaderboard">
      <header className="lb-header">
        <div className="lb-header-copy">
          <span>HAIRTO ARENA / THE SEASON’S BEST</span>
          <h1>
            LEADERBOARD<span>.</span>
          </h1>
        </div>
        <div className="lb-toolbar">
          <div className="lb-tabs" role="tablist" aria-label="Leaderboard views">
            {(['rankings', 'rewards'] as const).map((value) => (
              <button
                key={value}
                id={`${tabId}-${value}`}
                type="button"
                role="tab"
                aria-selected={tab === value}
                aria-controls={`${tabId}-panel`}
                tabIndex={tab === value ? 0 : -1}
                onClick={() => setTab(value)}
                onKeyDown={(event) => {
                  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    const next =
                      event.key === 'Home'
                        ? 'rankings'
                        : event.key === 'End'
                          ? 'rewards'
                          : tab === 'rankings'
                            ? 'rewards'
                            : 'rankings';
                    setTab(next);
                    document.getElementById(`${tabId}-${next}`)?.focus();
                  }
                }}
              >
                <span aria-hidden="true">{value === 'rankings' ? '♛' : '✦'}</span>
                {value === 'rankings' ? 'RANKINGS' : 'REWARDS'}
              </button>
            ))}
          </div>
          <span className="lb-season-label">
            <i /> {demo ? 'SAMPLE STANDINGS' : 'SEASON STANDINGS'}
          </span>
        </div>
        <div className="lb-header-seal">
          <Trophy />
          <div>
            <strong>{PRIZE_CURVE_BPS.length}</strong>
            <span>PRIZE PLACES</span>
          </div>
        </div>
      </header>
      <div
        className="lb-content"
        id={`${tabId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabId}-${tab}`}
      >
        {tab === 'rankings' ? (
          <>
            <div className="lb-podium" aria-label="Top three fighters">
              {podium.map(({ fighter, rank }) => (
                <article
                  key={rank}
                  className={`lb-champion lb-champion-${rank}${!fighter ? ' is-empty' : ''}`}
                >
                  <div className="lb-champion-backdrop" aria-hidden="true">
                    <span>{rank}</span>
                    <i />
                  </div>
                  <div className="lb-champion-category">
                    <span>
                      {rank === 1
                        ? 'THE CHAMPION'
                        : rank === 2
                          ? 'THE CHALLENGER'
                          : 'THE CONTENDER'}
                    </span>
                    {rank === 1 && (
                      <svg viewBox="0 0 36 25" fill="none" aria-hidden="true">
                        <path d="m3 4 8 8L18 2l7 10 8-8-4 18H7L3 4Z" fill="currentColor" />
                      </svg>
                    )}
                  </div>
                  <div className="lb-champion-portrait">
                    <Image
                      src={characterPortrait(portraitId(fighter, rank - 1))}
                      alt=""
                      width={1024}
                      height={1536}
                      sizes="(max-width: 650px) 30vw, 280px"
                      draggable={false}
                    />
                  </div>
                  <div className="lb-champion-footer">
                    <div className="lb-champion-name" title={fighter?.address}>
                      {fighter?.name ?? 'YOUR NAME HERE'}
                      {fighter?.demo && <b>DEMO</b>}
                      {fighter && isMe(fighter) && <b>YOU</b>}
                    </div>
                    <div className="lb-champion-score">
                      {fighter ? formatScore(fighter.score) : '—'}
                      <span>SEASON PTS</span>
                    </div>
                    <div className="lb-champion-detail">
                      <span>{fighter ? `${fighter.duels} DUELS` : 'AWAITING A FIGHTER'}</span>
                      <span>#{rank}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <div className="lb-list-heading">
              <span>THE CONTENDERS</span>
              <span>DUELS</span>
              <span>SEASON POINTS</span>
            </div>
            <div className="lb-list-scroll" tabIndex={0} aria-label="Ranked fighters">
              {board.isPending ? (
                <div className="lb-empty" role="status">
                  <Trophy />
                  <h2>Gathering the champions…</h2>
                  <p>Loading this season’s standings.</p>
                </div>
              ) : board.isError ? (
                <div className="lb-empty" role="status">
                  <h2>The board is resting.</h2>
                  <p>Rankings could not be loaded.</p>
                  <button type="button" onClick={() => void board.refetch()}>
                    TRY AGAIN ↻
                  </button>
                </div>
              ) : fighters.length === 0 ? (
                <div className="lb-empty">
                  <Trophy />
                  <h2>The first legend could be you.</h2>
                  <p>
                    Complete {SCORE.minDuelsForLeaderboard} duels to enter this season’s
                    leaderboard.
                  </p>
                </div>
              ) : (
                <ol className="lb-list" start={4}>
                  {fighters.slice(3).map((fighter, offset) => {
                    const index = offset + 3;
                    return (
                      <li
                        key={fighter.address}
                        className={`lb-row${isMe(fighter) ? ' is-me' : ''}`}
                        data-rank={String(fighter.rank ?? index + 1).padStart(2, '0')}
                        data-podium={index < 3 ? index + 1 : undefined}
                        aria-current={isMe(fighter) ? 'true' : undefined}
                      >
                        <span className="lb-row-rank">
                          {index < 3 ? (
                            <Trophy
                              metal={index === 0 ? 'gold' : index === 1 ? 'silver' : 'bronze'}
                            />
                          ) : (
                            <span>{String(fighter.rank ?? index + 1).padStart(2, '0')}</span>
                          )}
                        </span>
                        <div className="lb-row-avatar">
                          <CharacterPortrait id={portraitId(fighter, index)} size={96} />
                        </div>
                        <div className="lb-row-identity">
                          <strong title={fighter.address}>{fighter.name}</strong>
                          <span>
                            {isMe(fighter) ? <b>YOU</b> : fighter.demo ? <b>DEMO</b> : 'FIGHTER'}
                            <i />
                            {index === 0
                              ? 'Season leader'
                              : index < 3
                                ? 'Podium contender'
                                : 'Arena contender'}
                          </span>
                        </div>
                        <span className="lb-row-duels">
                          {fighter.duels}
                          <small>duels</small>
                        </span>
                        <strong className="lb-row-score">
                          {formatScore(fighter.score)}
                          <span>PTS</span>
                        </strong>
                      </li>
                    );
                  })}
                  {fighters.length <= 3 && (
                    <li className="lb-next-contender">
                      <span>04</span>
                      <div>
                        <strong>The next place is waiting.</strong>
                        <p>Complete your qualifying duels and join the board.</p>
                      </div>
                      <span>↗</span>
                    </li>
                  )}
                </ol>
              )}
            </div>
          </>
        ) : (
          <div className="lb-rewards">
            <header className="lb-rewards-hero">
              <Trophy />
              <div>
                <span>THE SPOILS OF THE SEASON</span>
                <h2>
                  A place at the top.
                  <br />
                  <em>A share of the glory.</em>
                </h2>
                <p>
                  Top {PRIZE_CURVE_BPS.length} eligible fighters share the Fighter prize allocation.
                </p>
              </div>
            </header>
            <div className="lb-split">
              <div>
                <span>FIGHTERS</span>
                <strong>
                  {POT_SPLIT.fighterBps / 100}
                  <small>%</small>
                </strong>
              </div>
              <i />
              <div>
                <span>BACKERS</span>
                <strong>
                  {POT_SPLIT.backerBps / 100}
                  <small>%</small>
                </strong>
              </div>
              <p>
                Share of the Season Pot.
                <br />
                Your principal stays in your vault.
              </p>
            </div>
            <div className="lb-reward-heading">
              <span>FINAL RANK</span>
              <span>FIGHTER ALLOCATION</span>
            </div>
            <ol className="lb-reward-list">
              {PRIZE_ROWS.map(({ from, to, bps }) => (
                <li key={from}>
                  <span>
                    {from <= 3 ? (
                      <Trophy metal={from === 1 ? 'gold' : from === 2 ? 'silver' : 'bronze'} />
                    ) : (
                      <i>◆</i>
                    )}
                    <strong>{from === to ? `#${from}` : `#${from}–${to}`}</strong>
                  </span>
                  <span>
                    <strong>{bps / 100}%</strong>
                    <small>{from === to ? 'of Fighter prizes' : 'each fighter'}</small>
                  </span>
                </li>
              ))}
            </ol>
            <p className="lb-rewards-note">
              Complete at least {SCORE.minDuelsForLeaderboard} qualifying duels this season to be
              ranked.
            </p>
          </div>
        )}
      </div>
      <footer className="lb-personal">
        <div className="lb-personal-rank">
          <span>YOUR RANK</span>
          <strong>{myRank ? `#${myRank}` : '—'}</strong>
        </div>
        <div className="lb-personal-avatar">
          <CharacterPortrait id={selectedFighter.id} size={128} />
        </div>
        <div className="lb-personal-info">
          <small className="lb-personal-fighter">{selectedFighter.title}</small>
          <strong>
            {address ? shortAddress(address) : 'Your fighter'}
            <b>YOU</b>
          </strong>
          <span>
            {qualified
              ? 'Qualified · keep climbing'
              : `${myDuels} / ${SCORE.minDuelsForLeaderboard} qualifying duels`}
          </span>
          <div
            className="lb-personal-progress"
            role="progressbar"
            aria-label="Leaderboard qualification"
            aria-valuemin={0}
            aria-valuemax={SCORE.minDuelsForLeaderboard}
            aria-valuenow={myDuels}
          >
            <i
              style={{ width: `${Math.min(100, (myDuels / SCORE.minDuelsForLeaderboard) * 100)}%` }}
            />
          </div>
        </div>
        <div className="lb-personal-points">
          <strong>{formatScore(me?.points ?? 0)}</strong>
          <span>SEASON PTS</span>
        </div>
      </footer>
      {demo && (
        <p className="lb-demo-note">
          Demo fighters preview the layout. They are not real season rankings.
        </p>
      )}
    </section>
  );
}
