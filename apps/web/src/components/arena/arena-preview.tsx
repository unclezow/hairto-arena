'use client';

import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Component,
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { BattleDialog } from '../play/battle-dialog';
import { useSelectedFighter } from '../play/mock-fighters';
import { ArenaIcon } from './arena-icons';
import { ArenaBackButton } from './arena-back-button';
import { CombatLab } from './combat-lab';
import {
  ATTACKS,
  type AttackKind,
  type AttackRequest,
  type FighterSide,
  type CombatStage,
} from './arena-combat';
import './combat.css';
import { FighterHud } from './fighter-hud';
import { ArenaLeaveGuard } from './arena-leave-guard';
import { ArenaCountdown } from './arena-countdown';
import { ArenaSettling } from './arena-settling';
import type { ArenaOutcome } from './arena-outcome';
import { featureReady } from '@/lib/features';
import { ArenaOutro } from './arena-outro';
import { OnchainLog } from './onchain-log';
import { useArenaAudio } from './use-arena-audio';
import { ArenaAudioControls } from './arena-audio-controls';
import { TradingPanel, type LivePanel } from './trading-panel';
import { ArenaIntro } from './arena-intro';

const ArenaScene = dynamic(() => import('./arena-scene'), {
  ssr: false,
  loading: () => (
    <div className="arena-loading">
      <span className="arena-spinner" />
      Preparing the grounds…
    </div>
  ),
});

function subscribeMotion(callback: () => void) {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

/** HP changes one closed position applies, by side, for the animation that shows it. */
type LiveHit = { attacker: FighterSide; kind: AttackKind; left: number; right: number };


class SceneBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure();
  }
  render() {
    if (this.state.failed)
      return (
        <div className="arena-loading" role="alert">
          <p>Scene 3D belum bisa dimuat.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Coba lagi ↗
          </button>
        </div>
      );
    return this.props.children;
  }
}

export function ArenaPreview() {
  const player = useSelectedFighter();
  const [paused, setPaused] = useState(false);
  const { engine: audio, snapshot: audioSnapshot } = useArenaAudio();
  const activeAudioAttack = useRef<AttackRequest | null>(null);
  const [attack, setAttack] = useState<AttackRequest | null>(null);
  const [stage, setStage] = useState<CombatStage>('idle');
  const [hp, setHp] = useState({ left: 1000, right: 1000 });
  const [hit, setHit] = useState<{ id: number; target: FighterSide; damage: number } | null>(null);
  const attackCounter = useRef(0);
  const locked = useRef(false);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const onLoadFailed = useCallback(() => setLoadFailed(true), []);
  const [entered, setEntered] = useState(false);
  const finishIntro = useCallback(() => {
    audio.finishIntro();
    setEntered(true);
  }, [audio]);
  const reducedMotion = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => true,
  );
  const onReady = useCallback(() => {
    setLoadFailed(false);
    setReady(true);
  }, []);
  const playing = !paused && !reducedMotion;
  const onAttack = useCallback(
    (kind: AttackKind, attacker: FighterSide) => {
      if (!ready || !entered || reducedMotion || locked.current || hp.left <= 0 || hp.right <= 0)
        return;
      locked.current = true;
      setPaused(false);
      setHit(null);
      setStage('charging');
      const request = { id: ++attackCounter.current, kind, attacker };
      activeAudioAttack.current = request;
      audio.charge(request);
      setAttack(request);
    },
    [ready, entered, reducedMotion, audio, hp],
  );
  const onImpact = useCallback(
    (request: AttackRequest) => {
      const target = request.attacker === 'left' ? 'right' : 'left';
      const liveHit = liveHits.current.get(request.id);
      if (liveHit) {
        liveHits.current.delete(request.id);
        setHp((current) => ({
          left: Math.max(0, current.left + liveHit.left),
          right: Math.max(0, current.right + liveHit.right),
        }));
        setHit({ id: request.id, target, damage: -liveHit[target] });
      } else {
        const damage = ATTACKS[request.kind].damage;
        setHp((current) => ({ ...current, [target]: Math.max(0, current[target] - damage) }));
        setHit({ id: request.id, target, damage });
      }
      audio.impact(request);
    },
    [audio],
  );
  const onFinish = useCallback(
    (id: number) => {
      locked.current = false;
      if (activeAudioAttack.current?.id === id) {
        activeAudioAttack.current = null;
        audio.finish();
      }
      setAttack((current) => (current?.id === id ? null : current));
      setHit(null);
    },
    [audio],
  );
  const onAudioStage = useCallback(
    (next: CombatStage) => {
      setStage(next);
      const request = activeAudioAttack.current;
      if (request && next === 'release') audio.release(request);
    },
    [audio],
  );
  // near-web-duel replaces this fence with the NEAR ticket, event and transaction flow.
  const router = useRouter();
  const search = useSearchParams();
  const [duelId] = useState<string | null>(null);
  const [livePanel] = useState<LivePanel | undefined>(undefined);
  const [outcome] = useState<ArenaOutcome | null>(null);
  const liveHits = useRef(new Map<number, LiveHit>());
  const live = { phase: 'loading', state: { startTs: null as number | null } };
  const starting = false;
  const fromLobby = false;
  const inDuel = false;
  const knockedOut = false;
  const stopped = false;
  const startError = (search.get('duel') || search.get('start')) && !featureReady('duel')
    ? { title: 'DUELS NOT AVAILABLE YET', hint: 'Live arena play will be enabled in the duel update. The scene remains a local preview.' }
    : null;

  const onReset = useCallback(() => {
    if (!locked.current) {
      setHp({ left: 1000, right: 1000 });
      setHit(null);
    }
  }, []);

  return (
    <main
      className="arena-page"
      data-combat-kind={attack?.kind ?? 'idle'}
      data-combat-stage={stage}
      data-arena-phase={!ready ? 'loading' : entered ? 'active' : 'intro'}
    >
      <div className="arena-topbar">
        {inDuel ? <span aria-hidden="true" /> : <ArenaBackButton />}
        <div className="arena-battle-hud">
          <FighterHud
            number="01"
            name={player.title}
            role={`YOU · ${player.kind.toUpperCase()}`}
            team="blue"
            hp={hp.left}
            hit={hit?.target === 'left' ? hit : null}
          />
          <div className="arena-battle-versus">
            <span>VS</span>
            {livePanel && (
              <small
                className="arena-battle-timer"
                data-urgent={knockedOut || (livePanel.secondsLeft <= 10 && live.phase === 'live')}
                aria-label={`${livePanel.secondsLeft} seconds left`}
              >
                {knockedOut ? 'K.O.' : livePanel.secondsLeft}
                <i>{knockedOut ? 'GAME OVER' : 'SEC'}</i>
              </small>
            )}
          </div>
          <FighterHud
            number="02"
            name="The Berserker"
            role="BOT · BARBARIAN"
            team="orange"
            hp={hp.right}
            hit={hit?.target === 'right' ? hit : null}
          />
        </div>
        <div className="arena-side-tools">
          <CombatLab
            ready={ready && entered && !duelId}
            busy={!!attack}
            reducedMotion={reducedMotion}
            defeated={hp.left <= 0 || hp.right <= 0}
            onAttack={onAttack}
            onReset={onReset}
          />
          <div className="arena-controls">
            <ArenaAudioControls engine={audio} snapshot={audioSnapshot} />
            <button
              type="button"
              className="arena-icon-button"
              disabled={!entered || reducedMotion || !!attack}
              onClick={() => setPaused((p) => !p)}
              aria-label={playing ? 'Pause animation' : 'Resume animation'}
              aria-pressed={!playing}
              title={
                reducedMotion
                  ? 'Reduced motion is enabled'
                  : playing
                    ? 'Pause animation'
                    : 'Resume animation'
              }
            >
              <ArenaIcon name={playing ? 'pause' : 'play'} />
            </button>
          </div>
        </div>
      </div>
      {entered &&
        livePanel &&
        live.phase === 'live' &&
        !knockedOut &&
        livePanel.secondsLeft <= 10 && <ArenaCountdown seconds={livePanel.secondsLeft} />}
      <ArenaLeaveGuard active={inDuel} />

      {startError && (
        <BattleDialog
          flow={{ kind: 'error', ...startError }}
          step="idle"
          onClose={() => router.push('/play/lobby')}
          onRetry={() => router.push('/play/lobby')}
        />
      )}
      {duelId && entered && stopped && live.phase !== 'over' && (
        <ArenaSettling phase={knockedOut && live.phase === 'live' ? 'ko' : 'reveal'} />
      )}
      {duelId && outcome && <ArenaOutro outcome={outcome} duelId={duelId} />}
      {duelId && <OnchainLog duelId={duelId} live={live.phase !== 'over'} />}
      {attack && (
        <div
          key={attack.id}
          className={`combat-announcement combat-announcement-${attack.kind}`}
          aria-live="polite"
        >
          <span>
            {attack.attacker === 'left' ? player.title.toUpperCase() : 'THE BERSERKER'} /{' '}
            {ATTACKS[attack.kind].label.toUpperCase()}
          </span>
          <strong>{ATTACKS[attack.kind].name}</strong>
          <span>
            {stage === 'impact' ? 'DIRECT HIT' : stage === 'release' ? 'UNLEASHED' : 'CHARGING'}
          </span>
        </div>
      )}
      {attack?.kind === 'ultimate' && (
        <div
          key={`intro-${attack.id}`}
          className="combat-screen-flash combat-intro-flash"
          aria-hidden="true"
        />
      )}
      {attack?.kind === 'ultimate' && stage === 'impact' && (
        <div
          key={`impact-${attack.id}`}
          className="combat-screen-flash combat-impact-flash"
          aria-hidden="true"
        />
      )}
      <div className="arena-canvas-wrap" aria-busy={!ready}>
        <SceneBoundary onFailure={onLoadFailed}>
          <ArenaScene
            playerKind={player.kind}
            playing={entered && !reducedMotion && (!paused || !!outcome)}
            outcome={outcome}
            hp={hp}
            attack={attack}
            onReady={onReady}
            onImpact={onImpact}
            onFinish={onFinish}
            onStage={onAudioStage}
          />
        </SceneBoundary>
      </div>

      <TradingPanel enabled={entered} live={livePanel} />
      {!entered && (
        <ArenaIntro
          // Remount once the assets and the start time are known, so the countdown begins from the right second.
          key={`${ready}-${fromLobby || live.state.startTs !== null}`}
          live={
            duelId || starting ? { startTs: live.state.startTs, synced: !fromLobby } : undefined
          }
          player={player}
          audio={audio}
          snapshot={audioSnapshot}
          reducedMotion={reducedMotion}
          assetsReady={ready}
          failed={loadFailed}
          onComplete={finishIntro}
        />
      )}
      <h1 id="arena-title" className="sr-only">
        The proving grounds
      </h1>
    </main>
  );
}
