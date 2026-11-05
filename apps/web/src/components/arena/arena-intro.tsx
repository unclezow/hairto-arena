'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { ArenaAudio, AudioSnapshot } from './arena-audio';
import { ArenaVersus } from './arena-versus';
import type { OwnedFighter } from '../play/mock-fighters';
import { ArenaLoadingScreen } from './arena-loading-screen';
import './arena-intro.css';

const STAGES = [
  { cue: 'versus', text: 'VERSUS', duration: 3200, subtitle: 'MATCH FOUND' },
  { cue: 'round', text: 'ROUND 1', duration: 1500, subtitle: 'THE FLOATING GROUNDS' },
  { cue: '3', text: '3', duration: 900, subtitle: 'PREPARE YOUR NEXT MOVE' },
  { cue: '2', text: '2', duration: 900, subtitle: 'PREPARE YOUR NEXT MOVE' },
  { cue: '1', text: '1', duration: 900, subtitle: 'PREPARE YOUR NEXT MOVE' },
  { cue: 'fight', text: 'FIGHT!', duration: 1300, subtitle: 'READ THE MARKET. RULE THE ARENA.' },
] as const;
export type IntroCue = (typeof STAGES)[number]['cue'];

/**
 * A live duel's round starts on-chain a few seconds after the duel is created, whatever the arena is doing. So the
 * cinematic is dropped and only the countdown is played, starting from whatever is left of it.
 */
const LIVE_STAGES = [
  { cue: '3', text: '3', duration: 1000, subtitle: 'PREPARE YOUR NEXT MOVE' },
  { cue: '2', text: '2', duration: 1000, subtitle: 'PREPARE YOUR NEXT MOVE' },
  { cue: '1', text: '1', duration: 1000, subtitle: 'PREPARE YOUR NEXT MOVE' },
  { cue: 'fight', text: 'FIGHT!', duration: 700, subtitle: 'READ THE MARKET. RULE THE ARENA.' },
] as const;

/** Where in the countdown a live duel is right now, from the seconds left before its round starts. */
function liveFirstStep(startTs: number): number {
  const left = startTs - Date.now() / 1000;
  return left >= 3 ? 0 : left >= 2 ? 1 : left >= 1 ? 2 : 3;
}

/** Covers the arena from the initial server render through asset preparation. */
export function ArenaIntro({
  player,
  audio,
  snapshot,
  reducedMotion,
  assetsReady,
  failed,
  live,
  onComplete,
}: {
  player: OwnedFighter;
  audio: ArenaAudio;
  snapshot: AudioSnapshot;
  reducedMotion: boolean;
  assetsReady: boolean;
  failed: boolean;
  /**
   * Set for a live duel: only the countdown is played. `synced` follows the duel's own start (a reload mid-duel); an
   * unsynced countdown simply runs from 3 while the duel is being created in the background.
   */
  live?: { startTs: number | null; synced: boolean };
  onComplete: () => void;
}) {
  const stages = live ? LIVE_STAGES : STAGES;
  const [step, setStep] = useState(() =>
    live?.synced && live.startTs != null ? liveFirstStep(live.startTs) : 0,
  );
  const [portraitsReady, setPortraitsReady] = useState(false);
  const onPortraitsReady = useCallback(() => setPortraitsReady(true), []);
  const played = useRef<IntroCue | null>(null);
  const stage = stages[step]!;
  const preparing =
    !assetsReady || failed || (live ? live.synced && live.startTs === null : !portraitsReady);
  useEffect(() => {
    if (preparing) return;
    let remaining: number = stage.duration;
    let started = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (document.hidden) return;
      started = performance.now();
      timer = setTimeout(() => {
        if (step === stages.length - 1) onComplete();
        else setStep((current) => current + 1);
      }, remaining);
    };
    const visibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        remaining = Math.max(0, remaining - (performance.now() - started));
      } else schedule();
    };
    schedule();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [step, stage.duration, stages.length, preparing, onComplete]);
  useLayoutEffect(() => {
    if (!snapshot.unlocked || snapshot.preferences.muted) return;
    if (preparing) return;
    if (played.current === stage.cue) return;
    played.current = stage.cue;
    audio.introCue(stage.cue);
  }, [audio, stage.cue, preparing, snapshot.unlocked, snapshot.preferences.muted]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !preparing) onComplete();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onComplete, preparing]);
  return (
    <div
      className={`arena-intro arena-intro-${preparing ? 'loading' : stage.cue}`}
      data-intro-step={preparing ? 'loading' : stage.cue}
    >
      {preparing && <ArenaLoadingScreen failed={failed} />}
      <div className="arena-intro-vignette" aria-hidden="true" />
      <div className="arena-intro-letterbox arena-intro-letterbox-top" aria-hidden="true" />
      <div className="arena-intro-letterbox arena-intro-letterbox-bottom" aria-hidden="true" />
      {stage.cue === 'versus' ? (
        <div inert={preparing} aria-hidden={preparing}>
          <ArenaVersus player={player} reducedMotion={reducedMotion} onReady={onPortraitsReady} />
        </div>
      ) : (
        <div className="arena-intro-stage" key={stage.cue}>
          <div className="arena-intro-halo" aria-hidden="true" />
          <svg
            className="arena-intro-ornament"
            viewBox="0 0 720 320"
            fill="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient
                id="intro-gold"
                x1="0"
                y1="0"
                x2="720"
                y2="0"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#ab9860" stopOpacity="0" />
                <stop offset=".3" stopColor="#d5bf83" />
                <stop offset=".5" stopColor="#fff0bf" />
                <stop offset=".7" stopColor="#d5bf83" />
                <stop offset="1" stopColor="#ab9860" stopOpacity="0" />
              </linearGradient>
            </defs>
            <g stroke="url(#intro-gold)">
              <path d="M0 143h128l24-24h69m278 0h69l24 24h128M26 153h110l24-24h49m302 0h49l24 24h110" />
              <path d="M0 177h128l24 24h69m278 0h69l24-24h128M26 167h110l24 24h49m302 0h49l24-24h110" />
              <path d="M153 143 170 160 153 177 136 160Z m414 0 17 17-17 17-17-17Z" />
              <path d="M205 76h87l20-12h96l20 12h87M205 244h87l20 12h96l20-12h87" opacity=".65" />
              <path d="m360 20 12 18-12 18-12-18Z m0 244 12 18-12 18-12-18Z" />
              <path d="M330 38h-86m146 0h86M330 282h-86m146 0h86" opacity=".5" />
            </g>
            <g className="arena-intro-rings" stroke="#d8c58e">
              <circle cx="360" cy="160" r="109" strokeOpacity=".22" />
              <circle cx="360" cy="160" r="119" strokeOpacity=".12" strokeDasharray="2 8" />
              <path
                d="M270 86a117 117 0 0 1 51-35m78 0a117 117 0 0 1 51 35m0 148a117 117 0 0 1-51 35m-78 0a117 117 0 0 1-51-35"
                strokeOpacity=".65"
                strokeWidth="2"
              />
            </g>
          </svg>
          <div className="arena-intro-crest" aria-hidden="true">
            <svg viewBox="0 0 40 40" fill="none">
              <path d="m20 2 15 8v16L20 38 5 26V10L20 2Z" stroke="currentColor" />
              <path
                d="m12 11 17 18m-1-18L11 29m1-5 5 5m6-5 5-5m-4-5 5-3v5m-13-5-4-3v5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <p className="arena-intro-eyebrow">{stage.subtitle}</p>
          <div className="arena-intro-heading" role="status" aria-live="polite" aria-atomic="true">
            <span>{stage.text}</span>
          </div>
          <div className="arena-intro-rule" aria-hidden="true">
            <span />◆<span />
          </div>
          <p className="arena-intro-caption">
            {stage.cue === 'round'
              ? `${player.title.toUpperCase()}  /  THE BERSERKER`
              : stage.cue === 'fight'
                ? 'YOUR EDGE. YOUR VICTORY.'
                : 'ROUND 1'}
          </p>
          <div className="arena-intro-sparks" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <i key={i} style={{ '--spark': i } as CSSProperties} />
            ))}
          </div>
        </div>
      )}
      {snapshot.available && (!snapshot.unlocked || snapshot.preferences.muted) && (
        <button
          type="button"
          className="arena-intro-sound"
          onClick={() => {
            audio.setPreferences({ muted: false });
            void audio.unlock();
          }}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="m11 5-5 4H3v6h3l5 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
          </svg>
          {snapshot.preferences.muted ? 'Unmute sound' : 'Enable sound'}
        </button>
      )}
      <button
        type="button"
        className="arena-intro-skip"
        onClick={onComplete}
        hidden={preparing}
        disabled={preparing}
      >
        Skip intro <kbd>ESC</kbd>
      </button>
    </div>
  );
}
