'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNearWallet } from '@/lib/near/context';
import { FighterAvatar, Trophy } from './play-assets';
import type { OwnedFighter } from './mock-fighters';
import { CharacterPortrait } from './character-portrait';
import { SCORE } from '@hairto-arena/shared';
import { useLogout } from '@/hooks/use-login';
import { shortAddress, useMyDaily, useMyStanding } from '@/hooks/use-lobby-data';

/** Shown until a wallet is connected: neutral values, not a made-up profile. */
const NO_WALLET = '';

export function ProfilePortrait({ kind }: { kind: OwnedFighter['kind'] }) {
  if (kind === 'Knight') return <FighterAvatar />;
  const mage = kind === 'Mage';
  return (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true">
      <path d="M4 4h72v72H4Z" fill={mage ? '#263e4c' : '#1e3930'} />
      <path d="M0 67 67 0M19 83 83 19" stroke="#f5dfa4" strokeOpacity=".07" strokeWidth="12" />
      <path d="M13 80V65l18-12h18l18 12v15" fill={mage ? '#5a7695' : '#617344'} />
      <path d="m15 68 17-7 8 8 8-8 17 7" stroke="#d9c18a" strokeWidth="3" />
      <path d="M23 28c0-14 34-14 34 0v17c0 12-7 19-17 19S23 57 23 45Z" fill="#e2c19a" />
      {mage ? (
        <>
          <path d="m20 32 6-17L48 3l4 19 9 12" fill="#6f94b2" stroke="#acc6ce" strokeWidth="1.5" />
          <path d="m12 33 29-6 28 7-5 7-25-4-23 3Z" fill="#40576f" stroke="#bfcdbe" />
          <path d="m43 13 2 4 5 1-4 3 1 4-4-2-4 2 1-4-3-3 4-1Z" fill="#f2d996" />
          <path d="m27 48 13 6 13-6-5 15-8 7-8-7Z" fill="#e8e4cf" />
        </>
      ) : (
        <>
          <path
            d="M19 35V22L32 9l18 3 12 12-3 15-10-12-9 8-10-9Z"
            fill="#71623f"
            stroke="#ab9b6a"
          />
          <path d="m22 45 18 5 18-5-4 14-14 9-14-9Z" fill="#334c32" stroke="#829264" />
          <path d="m34 56 6 3 7-3" stroke="#b4b57d" />
        </>
      )}
      <path d="M31 41v4m18-4v4" stroke="#20312a" strokeWidth="4" strokeLinecap="round" />
      <path d="M9 7h62M8 8v40" stroke="#efe2b0" strokeOpacity=".2" />
    </svg>
  );
}

export function PlayerProfile({
  fighter,
  signedIn,
  onConnect,
  historyAction,
}: {
  fighter: OwnedFighter;
  /** The wallet has signed in to the API; a connected wallet alone shows nothing personal. */
  signedIn: boolean;
  onConnect: () => void;
  historyAction: ReactNode;
}) {
  const { accountId: walletAddress } = useNearWallet();
  const connectedAddress = signedIn ? walletAddress : undefined;
  const address = connectedAddress ?? NO_WALLET;
  const logout = useLogout();
  const standing = useMyStanding();
  const daily = useMyDaily();
  const required = SCORE.minDuelsForLeaderboard;
  const score = connectedAddress ? (standing.data?.points ?? 0) : 0;
  const duels = connectedAddress ? Math.min(required, standing.data?.duels ?? 0) : 0;
  const toGo = Math.max(0, required - duels);
  const played = connectedAddress ? (daily.data?.played ?? 0) : 0;
  const [infoOpen, setInfoOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState('idle'), 1800);
  }

  return (
    <div className="hub-profile" role="group" aria-label="Player profile, season statistics">
      <div className="hub-profile-portrait" title={fighter.title}>
        <div className="hub-profile-portrait-art">
          <CharacterPortrait id={fighter.id} size={96} />
        </div>
        <span>{fighter.kind}</span>
        <i aria-hidden="true" />
      </div>
      <div className="hub-profile-stats">
        <div className="hub-profile-address-row">
          {connectedAddress ? (
            <>
              <button
                type="button"
                className="hub-profile-address"
                onClick={copyAddress}
                title={`Wallet: ${address} · Click to copy`}
                aria-label={`Copy NEAR account ID ${address}`}
              >
                <span className="hub-profile-online" aria-hidden="true" />
                <strong>
                  {shortAddress(address)}
                </strong>
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M7 7h9v10H7ZM4 13H2V2h10v2"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="hub-profile-logout"
                onClick={logout}
                title="Disconnect wallet"
                aria-label="Disconnect wallet"
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M8 4H4v12h4m4-9 3 3-3 3m3-3H8"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </>
          ) : (
            <button
              type="button"
              className="hub-profile-address hub-profile-connect"
              onClick={onConnect}
              title="Connect wallet"
              aria-label="Connect wallet"
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M10 2.5v6m4.6-3.4a6.5 6.5 0 1 1-9.2 0"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
              <strong>CONNECT WALLET</strong>
            </button>
          )}
        </div>
        <div className="hub-profile-score" title="Season score">
          <Trophy />
          <strong>{score.toLocaleString('en-US')}</strong>
          <span>SEASON SCORE</span>
        </div>
        <div
          className="hub-profile-progress"
          role="progressbar"
          aria-label="Duels toward leaderboard eligibility"
          aria-valuemin={0}
          aria-valuemax={required}
          aria-valuenow={duels}
          aria-valuetext={`${duels} of ${required} duels. ${toGo} more duels to qualify for the leaderboard.`}
        >
          <span style={{ width: `${(duels / required) * 100}%` }} />
          <i aria-hidden="true" />
          <i aria-hidden="true" />
          <i aria-hidden="true" />
          <i aria-hidden="true" />
        </div>
      </div>
      <div className="hub-profile-duels" title={`${played} counted duels today. No daily limit.`}>
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <path
            d="m6 3 16 17-3 3L3 6V3h3Zm20 0L10 20l3 3L29 6V3h-3Z"
            fill="#e8d39b"
            stroke="#fff0bd"
          />
          <path
            d="m17 22 7-7m-9 7-7-7m12 8 6 6m-14-6-6 6"
            stroke="#b8b875"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
        <strong>{played}</strong>
        <span>TODAY</span>
        {connectedAddress && toGo > 0 && (
          <button
            type="button"
            className="hub-profile-info"
            aria-label={`${toGo} more duels to enter the leaderboard`}
            aria-expanded={infoOpen}
            onClick={() => setInfoOpen((open) => !open)}
            onBlur={() => setInfoOpen(false)}
          >
            !
          </button>
        )}
        {infoOpen && (
          <div className="hub-profile-info-card" role="status">
            <strong>
              {toGo} more {toGo === 1 ? 'duel' : 'duels'} to enter the leaderboard
            </strong>
            <span>
              Season duels: {duels}/{required}
            </span>
          </div>
        )}
      </div>
      {historyAction}
      <span className="hub-profile-copy-feedback" role="status">
        {copyState === 'copied'
          ? 'Account ID copied'
          : copyState === 'failed'
            ? 'Could not copy address'
            : ''}
      </span>
    </div>
  );
}
