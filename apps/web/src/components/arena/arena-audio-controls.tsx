'use client';

import type { ArenaAudio, AudioSnapshot } from './arena-audio';
import './arena-audio.css';

function Speaker({ muted }: { muted: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      {muted ? (
        <path d="m16 9 5 6m0-6-5 6" />
      ) : (
        <>
          <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
        </>
      )}
    </svg>
  );
}

export function ArenaAudioControls({
  engine,
  snapshot,
  scene = 'arena',
}: {
  engine: ArenaAudio;
  snapshot: AudioSnapshot;
  scene?: 'arena' | 'lobby';
}) {
  const { preferences, unlocked, available } = snapshot;
  const label = !available
    ? 'Audio unavailable'
    : preferences.muted
      ? 'Unmute audio'
      : unlocked
        ? 'Mute audio'
        : 'Enable sound';
  return (
    <div
      className="arena-audio-controls"
      data-audio-state={preferences.muted ? 'muted' : unlocked ? 'playing' : 'waiting'}
    >
      <button
        type="button"
        className="arena-icon-button arena-speaker-button"
        aria-label={label}
        title={label}
        aria-pressed={preferences.muted}
        disabled={!available}
        onClick={() => engine.toggle()}
      >
        <Speaker muted={preferences.muted} />
        {!unlocked && !preferences.muted && <span className="arena-audio-unlock-dot" />}
      </button>
      <details
        className="arena-audio-settings"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.currentTarget.open = false;
            event.currentTarget.querySelector('summary')?.focus();
          }
        }}
      >
        <summary
          className="arena-icon-button"
          aria-label="Audio settings"
          title="Audio settings"
          onClick={() => engine.ui()}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 7h16M4 17h16" />
            <circle cx="9" cy="7" r="3" fill="#405942" />
            <circle cx="15" cy="17" r="3" fill="#405942" />
          </svg>
        </summary>
        <div className="arena-audio-popover" role="group" aria-label="Sound levels">
          <div className="arena-audio-heading">
            <Speaker muted={preferences.muted} />
            <strong>Sound</strong>
            <span>
              {preferences.muted ? 'MUTED' : scene === 'lobby' ? 'LOBBY MIX' : 'ARENA MIX'}
            </span>
          </div>
          <label>
            <span>
              Music <output>{Math.round(preferences.music * 100)}%</output>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              aria-label="Music volume"
              value={Math.round(preferences.music * 100)}
              onChange={(event) =>
                engine.setPreferences({ music: Number(event.target.value) / 100 })
              }
            />
          </label>
          <label>
            <span>
              {scene === 'lobby' ? 'Menu effects' : 'Attack effects'}{' '}
              <output>{Math.round(preferences.effects * 100)}%</output>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              aria-label={scene === 'lobby' ? 'Menu effects volume' : 'Attack effects volume'}
              value={Math.round(preferences.effects * 100)}
              onChange={(event) =>
                engine.setPreferences({ effects: Number(event.target.value) / 100 })
              }
            />
          </label>
          <a
            href="https://opengameart.org/content/heartfelt-battle-loopable-fantasy-stringspianohorn"
            target="_blank"
            rel="noreferrer"
            className="arena-audio-credit"
          >
            ♫ Heartfelt Battle <span>by request ↗</span>
          </a>
        </div>
      </details>
    </div>
  );
}
