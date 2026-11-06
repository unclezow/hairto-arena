'use client';

import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { DUEL, type MarketView } from '@hairto-arena/shared';
import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { api } from '@/lib/api';
import { useDuelTrading } from '@/hooks/use-duel-trading';
import { useLiveDuel } from '@/hooks/use-live-duel';
import { DEFAULT_BOT_LEVEL, defaultMarket, useStartDuel } from '@/hooks/use-start-duel';
import { markResultFromArena } from '@/lib/duel-storage';
import { startErrorText } from '@/lib/start-errors';
import { BattleDialog } from '../play/battle-dialog';
import { useSelectedFighter } from '../play/mock-fighters';
import { ArenaIcon } from './arena-icons';
import { ArenaBackButton } from './arena-back-button';
import { CombatLab } from './combat-lab';
import {
  ATTACKS,
  attackKindFor,
  damageForBps,
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
import { arenaOutcome } from './arena-outcome';
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
type LiveHit = {
  attacker: FighterSide;
  kind: AttackKind;
  left: number;
  right: number;
  /** Shown at the tap from the price then; the chain's numbers correct it when its close arrives. */
  predicted?: boolean;
  entry?: PredictedHit;
};

/**
 * A hit shown at the tap. `left` and `right` are what the bars were actually lowered by (clamped, so a prediction
 * never shows a knock-out). `actual` holds the chain's numbers when its close arrived before the animation hit.
 */
type PredictedHit = {
  left: number;
  right: number;
  applied: boolean;
  actual?: { left: number; right: number };
};

/** A predicted hit the chain has not confirmed after this long is taken back. */
const PREDICT_TTL_MS = 12_000;

const clock = (unix: number) => new Date(unix * 1000).toISOString().slice(11, 19);

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

/**
 * One mounted arena per battle. With cache components Next keeps the page it leaves and shows it again for the same
 * route, so BATTLE would land on the previous arena: its HP, its used start attempt (no new duel was ever requested)
 * and its finished state. Every BATTLE carries a new `n`, and the duel it creates keeps it, so a battle is one
 * instance from the countdown to the result and the next battle starts from nothing. An arena opened by a duel id
 * alone (the match history) is keyed by that id.
 */
export function ArenaPreview() {
  const search = useSearchParams();
  const key = search.get('n') ?? `duel-${search.get('duel') ?? 'preview'}`;
  return <ArenaScreen key={key} />;
}

function ArenaScreen() {
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
        // A predicted hit never reaches 0: a knock-out is decided by the chain only. If the chain's close already
        // arrived, its numbers are used instead of the prediction.
        const floor = liveHit.predicted ? 1 : 0;
        const delta = liveHit.entry?.actual ?? liveHit;
        setHp((current) => {
          const next = {
            left: Math.max(floor, current.left + delta.left),
            right: Math.max(floor, current.right + delta.right),
          };
          if (liveHit.entry) {
            liveHit.entry.left = next.left - current.left;
            liveHit.entry.right = next.right - current.right;
            liveHit.entry.applied = true;
          }
          return next;
        });
        setHit({ id: request.id, target, damage: -delta[target] });
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
  // ---- live duel (`/arena?duel=<id>`); without it the arena stays the preview ---------------------------
  const router = useRouter();
  const search = useSearchParams();
  const duelId = search.get('duel');
  // From the lobby's BATTLE: the duel does not exist yet. It is created below once the scene is ready.
  const starting = search.get('start') === '1' && !duelId;
  const { start: startDuel } = useStartDuel();
  // Arrived from the lobby's BATTLE: the intro countdown runs on its own while the duel is created behind it.
  const [fromLobby] = useState(() => search.get('start') === '1');
  const [startError, setStartError] = useState<{ title: string; hint: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const startedAttempt = useRef(-1);
  const liveHits = useRef(new Map<number, LiveHit>());
  const queue = useRef<LiveHit[]>([]);
  const [queued, setQueued] = useState(0);
  // Hits shown at the tap and not yet confirmed by the chain, newest last, and how many closes are awaited.
  const predicted = useRef<PredictedHit[]>([]);
  const expectClose = useRef(0);
  const predictCtx = useRef<{ side: 'long' | 'short' | null; entry?: number; price: number | null; assetId: number }>({
    side: null,
    price: null,
    assetId: 0,
  });
  const knockedOut = !!duelId && (hp.left <= 0 || hp.right <= 0);
  const live = useLiveDuel(
    duelId,
    (position) => {
      const self: FighterSide = position.isBot ? 'right' : 'left';
      const other: FighterSide = self === 'left' ? 'right' : 'left';
      const selfDelta = position.selfDelta ?? 0;
      const opponentDelta = position.opponentDelta ?? 0;
      const left = self === 'left' ? selfDelta : opponentDelta;
      const right = self === 'right' ? selfDelta : opponentDelta;
      if (!position.isBot && expectClose.current > 0) {
        // This close was already shown from the price at the tap: only the difference to the chain's numbers is
        // applied (the bars can go up again when the prediction was too high). If the animation has not hit yet, it
        // will use the chain's numbers.
        expectClose.current -= 1;
        const entry = predicted.current.shift();
        if (entry && entry.applied) {
          const fixLeft = left - entry.left;
          const fixRight = right - entry.right;
          if (fixLeft !== 0 || fixRight !== 0)
            setHp((h) => ({
              left: Math.min(DUEL.startingHp, Math.max(0, h.left + fixLeft)),
              right: Math.min(DUEL.startingHp, Math.max(0, h.right + fixRight)),
            }));
        } else if (entry) {
          entry.actual = { left, right };
        }
        return;
      }
      const damage = Math.max(-opponentDelta, -selfDelta, 0);
      if (damage === 0) return;
      queue.current.push({
        attacker: opponentDelta < 0 ? self : other,
        kind: attackKindFor(damage),
        left,
        right,
      });
      setQueued((n) => n + 1);
    },
    knockedOut,
  );
  // Close tapped: the hit this position deals at the current price shows at once, while the chain catches up.
  const onClosing = useCallback(() => {
    const c = predictCtx.current;
    if (!c.side || !c.entry || c.price === null) return;
    const bps = ((c.price - c.entry) / c.entry) * 10_000 * (c.side === 'long' ? 1 : -1);
    const damage = damageForBps(bps, c.assetId);
    if (damage === 0) return;
    const entry: PredictedHit = { left: 0, right: 0, applied: false };
    const hit: LiveHit =
      bps > 0
        ? { attacker: 'left', kind: attackKindFor(damage), left: 0, right: -damage, predicted: true, entry }
        : { attacker: 'right', kind: attackKindFor(damage), left: -damage, right: 0, predicted: true, entry };
    queue.current.push(hit);
    predicted.current.push(entry);
    expectClose.current += 1;
    setQueued((n) => n + 1);
    // A close the chain never confirms: take the hit back.
    setTimeout(() => {
      const at = predicted.current.indexOf(entry);
      if (at === -1) return;
      predicted.current.splice(at, 1);
      expectClose.current = Math.max(0, expectClose.current - 1);
      setHp((h) => ({
        left: Math.min(DUEL.startingHp, h.left - entry.left),
        right: Math.min(DUEL.startingHp, h.right - entry.right),
      }));
    }, PREDICT_TTL_MS);
  }, []);
  const trading = useDuelTrading(duelId, live, onClosing);
  const outcome =
    duelId && live.phase === 'over' && !attack && queued === 0
      ? arenaOutcome(live.state.status, live.state.fighter, live.state.winner)
      : null;
  useEffect(() => {
    if (!starting || !ready || startedAttempt.current === attempt) return;
    // One request per attempt, even if this effect runs again (strict mode, changing search params).
    startedAttempt.current = attempt;
    void (async () => {
      // The seed ticket is requested only now that the scene is ready, so the round never starts while assets load.
      const assetId =
        Number(search.get('asset')) || (await defaultMarket().catch(() => null))?.assetId;
      if (!assetId) {
        setStartError({
          title: 'NO MARKET OPEN',
          hint: 'Every market is closed right now. Try again later.',
        });
        return;
      }
      const started = await startDuel({
        assetId,
        botLevel: Number(search.get('bot')) || DEFAULT_BOT_LEVEL,
      });
      // The battle's `n` stays in the address so the arena is not mounted again when the duel id arrives.
      const battle = search.get('n');
      if (started.ok)
        router.replace(`/arena?duel=${started.duelId}${battle ? `&n=${encodeURIComponent(battle)}` : ''}`);
      else setStartError({ title: 'COULD NOT START', hint: startErrorText(started.code) });
    })();
  }, [starting, ready, attempt, search, startDuel, router]);
  const markets = useQuery({
    queryKey: ['markets'],
    queryFn: () => api<{ items: MarketView[] }>('/markets'),
    enabled: !!duelId || starting,
  });
  // Before the duel exists the panel shows the asset the player asked for, with its real recent prices, not the
  // chart's demo placeholder.
  const requestedAssetId = Number(search.get('asset'));
  const previewHistory = useQuery({
    queryKey: ['preview-history', requestedAssetId],
    queryFn: () =>
      api<{ items: { price: string }[] }>(`/prices/${requestedAssetId}/history?limit=17`),
    enabled: starting && Number.isSafeInteger(requestedAssetId) && requestedAssetId > 0,
    refetchInterval: 5_000,
  });
  const previewSeries = previewHistory.data?.items.map((q) => Number(q.price)) ?? [];
  const preview = {
    symbol: markets.data?.items.find((m) => m.assetId === requestedAssetId)?.symbol,
    price: previewSeries.at(-1),
    series: previewSeries,
  };
  useEffect(() => {
    if (!duelId) return;
    if (attack) return;
    const next = queue.current[0];
    if (next && ready && entered && !reducedMotion) {
      queue.current.shift();
      setQueued((count) => count - 1);
      locked.current = true;
      setPaused(false);
      setHit(null);
      setStage('charging');
      const request = { id: ++attackCounter.current, kind: next.kind, attacker: next.attacker };
      liveHits.current.set(request.id, next);
      activeAudioAttack.current = request;
      audio.charge(request);
      setAttack(request);
      return;
    }
    // Nothing left to animate (or no motion): the contract's HP lowers the bars when it is lower. HP never goes up in
    // a duel, so a chain value that lags behind a hit already shown (or a stale one arriving late) must not raise a
    // bar: that would bring a knocked-out fighter back for a moment.
    queue.current = [];
    setQueued(0);
    setHp((h) => ({
      left: Math.min(h.left, live.state.hp.fighter),
      right: Math.min(h.right, live.state.hp.bot),
    }));
  }, [duelId, attack, queued, ready, entered, reducedMotion, audio, live.state.hp]);
  useEffect(() => {
    if (!duelId || !outcome) return;
    audio.outcome(outcome);
    const timer = setTimeout(
      () => {
        markResultFromArena(String(duelId));
        router.push(`/duel/${duelId}/result`);
      },
      reducedMotion ? 1500 : 4000,
    );
    return () => clearTimeout(timer);
  }, [duelId, outcome, reducedMotion, audio, router]);
  // A fighter out of HP ends the game for the player at once, even though the chain settles at the round's end.
  const stopped = !!duelId && (knockedOut || live.phase === 'reveal' || live.phase === 'over');
  const quotes = live.quotes;
  const quotePrices = quotes.map((q) => Number(q.price));
  const lastQuote = quotes.at(-1);
  const entryQuote =
    trading.openedAt === null
      ? undefined
      : (quotes.findLast((q) => q.publishTime <= trading.openedAt! / 1000) ?? lastQuote);
  const lastClosed = live.state.positions.findLast((p) => !p.isBot && p.state === 'closed');
  const entry = entryQuote ? Number(entryQuote.price) : undefined;
  const current = lastQuote ? Number(lastQuote.price) : null;
  // A trade opened at a tick is priced on-chain at ticks only, so its entry and the price it is measured against
  // are ticks too: the PnL and the damage shown are then exactly what the arena computes.
  const pnlEntry = trading.entryPrice ?? entry;
  const pnlPrice = trading.entryPrice !== null && live.tick ? live.tick.price : current;
  useEffect(() => {
    predictCtx.current = {
      side: trading.side,
      entry: pnlEntry,
      price: pnlPrice,
      assetId: live.state.assetId ?? 0,
    };
  });
  // Once a duel exists the player cannot walk out of it; the exit comes back when it is over.
  const inDuel = !!duelId && live.phase !== 'over';
  const livePanel: LivePanel | undefined = duelId
    ? {
        // The price shown is the latest tick, the price a tap trades at, so the entry line sits where the price was
        // when the button was pressed. The candles keep the one-second quotes.
        price: live.tick ? live.tick.price : current,
        series: quotePrices,
        symbol: markets.data?.items.find((m) => m.assetId === live.state.assetId)?.symbol ?? '—',
        feed: 'PYTH FEED',
        timeLabel: lastQuote ? clock(lastQuote.publishTime) : '--:--:--',
        side: trading.side,
        entry: pnlEntry,
        assetId: live.state.assetId ?? 0,
        pnlBps:
          trading.side && pnlEntry && pnlPrice
            ? ((pnlPrice - pnlEntry) / pnlEntry) * 10_000 * (trading.side === 'long' ? 1 : -1)
            : lastClosed?.pnlPpm !== undefined
              ? lastClosed.pnlPpm / 100
              : null,
        tradesLeft: trading.tradesLeft,
        secondsLeft:
          live.phase === 'live' && live.endTs !== null
            ? Math.max(0, Math.ceil(live.endTs - live.now))
            : live.phase === 'countdown' || live.phase === 'loading'
              ? 30
              : 0,
        holdLeft: trading.holdLeft,
        canOpen: trading.canOpen && !knockedOut,
        canClose: trading.canClose && !knockedOut,
        onSide: knockedOut ? () => undefined : trading.chooseSide,
        status:
          trading.status ??
          (live.phase === 'loading'
            ? 'CONNECTING…'
            : live.phase === 'countdown' && live.state.startTs !== null
              ? `STARTS IN ${Math.max(0, Math.ceil(live.state.startTs - live.now))}s`
              : live.phase === 'reveal'
                ? 'ROUND OVER'
                : live.phase === 'over'
                  ? live.state.status === 'voided'
                    ? 'DUEL VOIDED'
                    : 'DUEL FINISHED'
                  : trading.tradesLeft === 0 && !trading.side
                    ? 'NO TRADES LEFT'
                    : null),
        message:
          trading.status ??
          trading.error ??
          (live.phase === 'countdown'
            ? 'Round starts soon'
            : live.phase === 'reveal'
              ? 'Round over, revealing positions'
              : live.phase === 'over'
                ? live.state.status === 'voided'
                  ? 'Duel voided'
                  : 'Duel finished'
                : ''),
      }
    : undefined;

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
          onRetry={() => {
            setStartError(null);
            setAttempt((n) => n + 1);
          }}
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

      <TradingPanel enabled={entered} live={livePanel} preview={preview} />
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
