'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BOT_LEVELS, type BotLevel, type MarketView } from '@hairto-arena/shared';
import { api } from '@/lib/api';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { FighterAvatar } from './play-assets';
import { PlayIcon } from './play-shell';
import { PlayerProfile } from './player-profile';
import { CurrencyAmount } from './currency-amount';
import { ConnectModal } from './connect-modal';
import { BattleDialog, type BattleFlow } from './battle-dialog';
import { BotSelector } from './bot-selector';
import { MarketSelector } from './market-selector';
import { VaultDialog, type VaultMode } from './vault-dialog';
import { VaultPanel } from './vault-panel';
import { FaucetButton } from './faucet-button';
import { ArenaCollection } from './arena-collection';
import { useArenaAudio } from '../arena/use-arena-audio';
import { ArenaAudioControls } from '../arena/arena-audio-controls';
import { MenuLightFlight, type MenuLaunch } from './menu-light-flight';
import './play-hub.css';
import { OWNED_FIGHTERS, selectMockFighter, useSelectedFighter } from './mock-fighters';
import { useBalances } from '@/hooks/use-balances';
import { useFighterReadiness } from '@/hooks/use-fighter-readiness';
import { useActiveBots } from '@/hooks/use-active-bots';
import { useOwnedCharacters } from '@/hooks/use-lobby-data';
import { DEFAULT_BOT_LEVEL, pickDefaultMarket } from '@/hooks/use-start-duel';
import { useNearWallet } from '@/lib/near/context';
import { MINIMUM_GAS_BALANCE, quickPlayPromptSeen } from '@/lib/onboarding';
import { lastSignInError, useWalletSession } from '@/hooks/use-wallet-session';

const LobbyFighter = dynamic(() => import('./lobby-fighter'), {
  ssr: false,
  loading: () => (
    <div className="hub-fighter-fallback">
      <FighterAvatar />
      <span>Summoning your fighter…</span>
    </div>
  ),
});

/** A popup is local UI state: changing its URL must not request a new server render. */
function setLobbyPanel(panel: MenuLaunch['panel'] | null) {
  const url = new URL(window.location.href);
  if (panel) url.searchParams.set('panel', panel);
  else url.searchParams.delete('panel');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function LockIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3" />
    </svg>
  );
}

export function PlayHub({
  leaderboard,
  store,
  history,
}: {
  leaderboard: ReactNode;
  store: ReactNode;
  history: ReactNode;
}) {
  const { engine: audio, snapshot: audioSnapshot } = useArenaAudio('lobby');
  const queryClient = useQueryClient();
  const selectedFighter = useSelectedFighter();
  const characters = useOwnedCharacters();
  // Owned: equip on-chain (debounced). Not owned: local preview only (NEAR frontend port).
  const selectFighter = (id: number) => {
    selectMockFighter(id);
    characters.equip(id);
  };
  // Start from what the wallet has equipped, once per wallet.
  const syncedEquip = useRef<string | null>(null);
  useEffect(() => {
    if (characters.equipped === null || !characters.walletKey) return;
    if (syncedEquip.current === characters.walletKey) return;
    syncedEquip.current = characters.walletKey;
    selectMockFighter(characters.equipped);
  }, [characters.equipped, characters.walletKey]);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const moveFighter = (direction: number) => {
    audio.ui();
    const current = OWNED_FIGHTERS.findIndex((fighter) => fighter.id === selectedFighter.id);
    selectFighter(
      OWNED_FIGHTERS[(current + direction + OWNED_FIGHTERS.length) % OWNED_FIGHTERS.length]!.id,
    );
  };
  const search = useSearchParams();
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(() => {
    const requestedAsset = Number(search.get('asset'));
    return Number.isSafeInteger(requestedAsset) && requestedAsset > 0 ? requestedAsset : null;
  });
  const markets = useQuery({
    queryKey: ['markets'],
    queryFn: ({ signal }) => api<{ items: MarketView[] }>('/markets', { signal }),
    refetchInterval: 15_000,
  });
  const assets = markets.data?.items ?? [];
  // Without an explicit choice the default is picked once from the first list and then kept, so a market that
  // flickers closed on a later refresh never swaps the asset the player sees for another one.
  const [defaultAssetId, setDefaultAssetId] = useState<number | null>(null);
  if (selectedAssetId === null && defaultAssetId === null && assets.length > 0) {
    const first = pickDefaultMarket(assets) ?? assets[0];
    if (first) setDefaultAssetId(first.assetId);
  }
  const activeAssetId = selectedAssetId ?? defaultAssetId;
  const selectedMarket =
    activeAssetId === null
      ? null
      : (assets.find((market) => market.assetId === activeAssetId) ?? null);
  const [botLevel, setBotLevel] = useState<BotLevel>(() => {
    const requestedLevel = Number(search.get('bot'));
    return requestedLevel === 1 || requestedLevel === 2 || requestedLevel === 3 || requestedLevel === 4
      ? requestedLevel
      : DEFAULT_BOT_LEVEL;
  });
  const session = useWalletSession();
  const router = useRouter();
  const activeBots = useActiveBots();
  // A level that is not active on the arena (for example the Oracle before it is configured) is never offered.
  if (!activeBots.levels.includes(botLevel) && activeBots.levels[0]) setBotLevel(activeBots.levels[0]);
  const { config } = useNearWallet();
  // Everything personal (address, BATTLE, vault, Leaderboard, Store) waits for the API sign-in, not just the wallet.
  const loggedIn = !!session.token;
  // /onboarding and the nav's Sign in link land here with ?connect=1.
  const [connectOpen, setConnectOpen] = useState(
    () => search.get('connect') === '1' || !!search.get('panel'),
  );
  const openConnect = useCallback(() => setConnectOpen(true), []);
  const closeConnect = useCallback(() => setConnectOpen(false), []);
  // The battle mode panel is a native <details>: a press outside it, or Escape, closes it.
  const modeMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = () => modeMenu.current?.removeAttribute('open');
    const onPointer = (event: PointerEvent) => {
      const menu = modeMenu.current;
      if (menu?.open && !menu.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && close();
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  const walletBalances = useBalances();
  const [onboardingAccount, setOnboardingAccount] = useState<string | null>(null);
  const onboardingKey = session.token && session.accountId ? `${session.accountId}:${session.token}` : null;
  if (!onboardingKey && onboardingAccount) setOnboardingAccount(null);
  if (onboardingKey && session.accountId && walletBalances.nearQuery.isSuccess && onboardingAccount !== onboardingKey) {
    setOnboardingAccount(onboardingKey);
    if (walletBalances.near < MINIMUM_GAS_BALANCE || !quickPlayPromptSeen(config.network, session.accountId)) setConnectOpen(true);
  }
  const [vaultOpen, setVaultOpen] = useState(false);
  const closeVault = useCallback(() => setVaultOpen(false), []);
  const toggleVault = () => {
    if (!loggedIn) {
      openConnect();
      return;
    }
    audio.ui();
    setVaultOpen((open) => !open);
  };
  // Balances stay at zero until the API sign-in; the chain data is public but the chips belong to a signed-in player.
  const balances = loggedIn ? walletBalances : { ...walletBalances, nearText: '0', usdcText: '0' };
  const readiness = useFighterReadiness();
  const [vaultDialog, setVaultDialog] = useState<{
    mode: VaultMode;
    notice: string | null;
  } | null>(null);
  const closeVaultDialog = useCallback(() => setVaultDialog(null), []);
  const openVaultDialog = (mode: VaultMode, notice: string | null = null) => {
    if (!loggedIn) {
      openConnect();
      return;
    }
    audio.ui();
    setVaultOpen(false);
    setVaultDialog({ mode, notice });
  };
  const [flow, setFlow] = useState<BattleFlow | null>(null);
  // A closed popup abandons its run: later results of that run are ignored.
  const runId = useRef(0);
  const closeFlow = useCallback(() => {
    runId.current += 1;
    setFlow(null);
  }, []);
  // Leaving the lobby (into the arena) must not leave the popup behind: Next keeps this page's state alive, so
  // coming back would still show "entering the arena".
  useEffect(
    () => () => {
      runId.current += 1;
      setFlow(null);
    },
    [],
  );
  const battleBusy = flow?.kind === 'working';
  const battle = async () => {
    if (!loggedIn) {
      openConnect();
      return;
    }
    if (battleBusy) return;
    const run = ++runId.current;
    const alive = () => run === runId.current;
    const fail = (title: string, hint: string) => setFlow({ kind: 'error', title, hint });
    try {
      if (!session.token) {
        setFlow({ kind: 'working', phase: 'signin' });
        if (!(await session.signIn())) {
          if (alive()) fail('SIGN-IN FAILED', lastSignInError() ?? 'Could not sign in. Try again.');
          return;
        }
        if (!alive()) return;
      }
      setFlow({ kind: 'working', phase: 'prepare' });
      const result = await readiness.ensureReady();
      if (!alive()) return;
      if (!result.ok) {
        if (result.reason === 'NEEDS_DEPOSIT') {
          // Funds move only when the player confirms in the vault dialog.
          setFlow(null);
          openVaultDialog('deposit', 'Deposit at least 10 USDC to play.');
        } else if (result.reason === 'WRONG_ROLE') {
          fail('BACKERS CANNOT DUEL', 'This account is a Backer. Use a Fighter account to play.');
        } else if (result.reason === 'NEEDS_GAS') {
          fail('ADD TESTNET NEAR FOR GAS', 'Get testnet NEAR from near-faucet.io, then press BATTLE again.');
        } else {
          console.error('[battle] prepare failed:', result.message);
          fail('COULD NOT PREPARE', 'Could not check your account. Try again.');
        }
        return;
      }
      setFlow({ kind: 'working', phase: 'start' });
      if (!selectedMarket) {
        fail('NO ASSET SELECTED', 'Open the SOLO panel and choose an available asset.');
        return;
      }
      if (!selectedMarket.open) {
        fail('MARKET CLOSED', 'This asset is not ready for trading. Choose an open market in the SOLO panel.');
        return;
      }
      // The seed ticket is requested and the duel created from the arena once the scene has loaded, so the
      // 30 s round never starts while the player waits for assets.
      setFlow({ kind: 'working', phase: 'enter' });
      router.push(`/arena?start=1&bot=${botLevel}&asset=${selectedMarket.assetId}&n=${Date.now()}`);
    } catch {
      if (alive()) fail('COULD NOT START', 'Something went wrong. Try again.');
    }
  };
  const requested = search.get('panel');
  // Leaderboard and Store are for signed-in players. A direct link opens once the sign-in is done.
  const panel =
    loggedIn && (requested === 'leaderboard' || requested === 'store' || requested === 'history')
      ? requested
      : null;
  const dialog = useRef<HTMLDialogElement>(null);
  const [launch, setLaunch] = useState<MenuLaunch | null>(null);
  const launching = useRef(false);
  // A panel that is open ends the launch animation; adjusting state while rendering avoids an effect.
  if (panel && launch) setLaunch(null);
  const closingAnimation = useRef<Animation | null>(null);
  const previousPanel = useRef<string | null>(null);
  const leaderboardTrigger = useRef<HTMLButtonElement>(null);
  const storeTrigger = useRef<HTMLButtonElement>(null);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const dismiss = useCallback(() => {
    const modal = dialog.current;
    if (modal?.dataset.closing === 'true') return;
    if (!modal?.open || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setLobbyPanel(null);
      return;
    }
    const currentClip = getComputedStyle(modal).clipPath;
    modal.dataset.closing = 'true';
    const animation = modal.animate(
      [{ clipPath: currentClip }, { clipPath: 'inset(calc(50% - 2px) 0 calc(50% - 2px) 0)' }],
      { duration: 280, easing: 'cubic-bezier(.55,0,.8,.3)', fill: 'forwards' },
    );
    closingAnimation.current = animation;
    void animation.finished
      .then(() => {
        if (dialog.current === modal && modal.open) setLobbyPanel(null);
      })
      .catch(() => {
        /* Navigation may unmount the popup during its exit. */
      });
  }, []);
  const open = (next: MenuLaunch['panel']) => {
    if (launching.current || panel) return;
    audio.ui();
    if (!loggedIn) {
      openConnect();
      return;
    }
    // Fetch during the light-flight animation so opening does not wait on the API.
    if (next === 'leaderboard') {
      void queryClient.prefetchQuery({
        queryKey: ['leaderboard'],
        queryFn: () => api('/leaderboard?limit=8'),
        staleTime: 15_000,
      });
    }
    const trigger =
      next === 'history'
        ? historyTrigger.current
        : next === 'leaderboard'
          ? leaderboardTrigger.current
          : storeTrigger.current;
    if (!trigger || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setLobbyPanel(next);
      return;
    }
    const bounds = trigger.getBoundingClientRect();
    launching.current = true;
    setLaunch({
      panel: next,
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
      width: innerWidth,
      height: innerHeight,
    });
  };
  useEffect(() => {
    const modal = dialog.current;
    if (!modal) return;
    if (panel) {
      launching.current = false;
      closingAnimation.current?.cancel();
      closingAnimation.current = null;
      delete modal.dataset.closing;
      if (!modal.open) modal.showModal();
      previousPanel.current = panel;
    } else if (modal.open) {
      modal.close();
      closingAnimation.current?.cancel();
      closingAnimation.current = null;
      delete modal.dataset.closing;
      const trigger =
        previousPanel.current === 'history'
          ? historyTrigger.current
          : previousPanel.current === 'store'
            ? storeTrigger.current
            : leaderboardTrigger.current;
      trigger?.focus();
    }
  }, [panel]);
  useEffect(() => () => closingAnimation.current?.cancel(), []);
  useEffect(() => {
    if (!panel) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [panel]);
  return (
    <main className="play-hub">
      <div className="hub-backdrop" aria-hidden="true" />
      <div className="hub-floor-glow" aria-hidden="true" />
      <header className="hub-header">
        <PlayerProfile
          fighter={selectedFighter}
          signedIn={loggedIn}
          onConnect={openConnect}
          historyAction={
            <button
              ref={historyTrigger}
              type="button"
              className="hub-profile-history hub-profile-duels"
              onClick={() => open('history')}
              disabled={!!launch}
              aria-label="History Match"
              title="History Match"
              aria-busy={launch?.panel === 'history'}
              aria-haspopup="dialog"
              aria-expanded={panel === 'history'}
            >
              <PlayIcon name="history" />
              <span>HISTORY</span>
            </button>
          }
        />
        <div className="hub-app-title" aria-label="Hairto Arena">
          <span>Hairto</span> <span>Arena</span>
        </div>
        <div
          className="hub-wallet-bar"
          role="group"
          aria-label={loggedIn ? 'Wallet balances' : 'Preview currency balances'}
        >
          <div
            className="hub-currency hub-currency-near"
            aria-label={`${balances.nearText} NEAR, ${loggedIn ? 'wallet' : 'preview'} balance`}
            title={`NEAR for gas · ${loggedIn ? 'Wallet' : 'Preview'} balance`}
          >
            <span className="hub-currency-icon">
              <Image
                src="/play/currencies/near-token.png"
                width={64}
                height={64}
                alt="NEAR"
                draggable={false}
                unoptimized
              />
            </span>
            <CurrencyAmount value={balances.nearText} symbol="NEAR (gas)" />
          </div>
          <div className="hub-currency-wrap">
            <div
              className="hub-currency hub-currency-usdc"
              role="button"
              tabIndex={0}
              aria-expanded={vaultOpen}
              aria-label={`${loggedIn ? balances.usdcText : '0'} USDC in game. Open balance details`}
              title={loggedIn ? 'Assets in game · balance details' : 'Connect a wallet'}
              onClick={toggleVault}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  toggleVault();
                }
              }}
            >
              <span className="hub-currency-icon">
                <Image
                  src="/play/currencies/usdc-coin-v1.png"
                  width={96}
                  height={96}
                  sizes="(max-width: 600px) 43px, 54px"
                  alt="USDC"
                  draggable={false}
                />
              </span>
              <CurrencyAmount value={loggedIn ? balances.usdcText : '0'} symbol="USDC" />
            </div>
            <button
              type="button"
              className="hub-currency-add"
              aria-label="Deposit or withdraw USDC"
              title="Deposit or withdraw"
              onClick={() => openVaultDialog('deposit')}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M10 4v12M4 10h12"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            {vaultOpen && loggedIn && <VaultPanel onClose={closeVault} />}
            <FaucetButton
              loggedIn={loggedIn}
              onConnect={openConnect}
              onClickSound={() => audio.ui()}
            />
          </div>
        </div>
      </header>
      <ConnectModal open={connectOpen} onClose={closeConnect} />
      {flow && (
        <BattleDialog
          flow={flow}
          step={readiness.step}
          onClose={closeFlow}
          onRetry={() => void battle()}
        />
      )}
      {vaultDialog && (
        <VaultDialog
          mode={vaultDialog.mode}
          notice={vaultDialog.notice}
          onClose={closeVaultDialog}
        />
      )}
      <div className="hub-top-caption">
        <h1>Ready for a duel?</h1>
      </div>
      <nav className="hub-menu" aria-label="Lobby menus">
        <button
          ref={leaderboardTrigger}
          type="button"
          onClick={() => open('leaderboard')}
          disabled={!!launch}
          aria-busy={launch?.panel === 'leaderboard'}
          aria-haspopup="dialog"
          aria-expanded={panel === 'leaderboard'}
        >
          <span className="hub-menu-art hub-generated-menu-art">
            <Image
              src="/play/icons/leaderboard-trophy-v1.png"
              width={128}
              height={128}
              sizes="(max-width: 600px) 61px, (max-width: 800px) 74px, 88px"
              alt=""
              draggable={false}
            />
          </span>
          <span>Leaderboard</span>
        </button>
        <button
          ref={storeTrigger}
          type="button"
          onClick={() => open('store')}
          disabled={!!launch}
          aria-busy={launch?.panel === 'store'}
          aria-haspopup="dialog"
          aria-expanded={panel === 'store'}
        >
          <span className="hub-menu-art hub-store-art hub-generated-menu-art">
            <Image
              src="/play/icons/store-chest-v1.png"
              width={128}
              height={128}
              sizes="(max-width: 600px) 61px, (max-width: 800px) 74px, 88px"
              alt=""
              draggable={false}
            />
          </span>
          <span>Store</span>
        </button>
      </nav>
      <section
        className="hub-character hub-character-carousel"
        aria-label="Your owned characters"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            moveFighter(event.key === 'ArrowLeft' ? -1 : 1);
          }
        }}
      >
        <div className="hub-character-aura" aria-hidden="true" />
        <div
          className="hub-character-canvas"
          onPointerDown={(event) => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            swipeStart.current = { x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={(event) => {
            const start = swipeStart.current;
            swipeStart.current = null;
            if (!start) return;
            const dx = event.clientX - start.x;
            if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(event.clientY - start.y))
              moveFighter(dx < 0 ? 1 : -1);
          }}
          onPointerCancel={() => {
            swipeStart.current = null;
          }}
        >
          <LobbyFighter
            paused={!!panel || !!launch || connectOpen || !!flow || !!vaultDialog}
            carouselId={selectedFighter.id}
            label="Three owned fighters. Swipe or use the arrows to equip the center fighter."
          />
        </div>
        <button
          type="button"
          className="hub-roster-arrow hub-roster-prev"
          aria-label="Previous character"
          onClick={() => moveFighter(-1)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 5-7 7 7 7" />
          </svg>
        </button>
        <button
          type="button"
          className="hub-roster-arrow hub-roster-next"
          aria-label="Next character"
          onClick={() => moveFighter(1)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m9 5 7 7-7 7" />
          </svg>
        </button>
        <div className="hub-character-name" aria-live="polite">
          <span>◆ {selectedFighter.kind.toUpperCase()} ◆</span>
          <strong>{selectedFighter.title}</strong>
          <small>{selectedFighter.motto}</small>
          <div className="hub-roster-dots" aria-label="Equipped character">
            {OWNED_FIGHTERS.map((fighter) => (
              <button
                key={fighter.id}
                type="button"
                aria-label={`Equip ${fighter.kind}`}
                aria-pressed={selectedFighter.id === fighter.id}
                onClick={() => selectFighter(fighter.id)}
              />
            ))}
          </div>
        </div>
      </section>
      <aside className="hub-audio-dock" aria-label="Lobby sound controls">
        <ArenaAudioControls engine={audio} snapshot={audioSnapshot} scene="lobby" />
        <span className="hub-audio-caption">SOUND</span>
      </aside>
      <ArenaCollection onOpen={() => audio.ui()} />
      <footer className="hub-battle-dock hub-corner-dock">
        <details ref={modeMenu} className="hub-battle-mode">
          <summary
            aria-label={`Battle mode: Solo versus ${BOT_LEVELS[botLevel].name}, ${selectedMarket?.symbol ?? 'no asset selected'}. Choose mode, opponent and asset`}
          >
            <span className="hub-corner-mode-emblem" aria-hidden="true">
              <svg viewBox="0 0 64 64" fill="none">
                <path
                  d="m32 3 23 10v19c0 14-13 23-23 29C22 55 9 46 9 32V13Z"
                  fill="#193b2d"
                  stroke="#dec992"
                  strokeWidth="3"
                />
                <path
                  d="m32 9 17 8v15c0 10-9 18-17 23-8-5-17-13-17-23V17Z"
                  fill="#5e7845"
                  stroke="#9fa86a"
                />
                <path d="m21 17 23 24-4 4-23-24v-4h4Zm22 0L20 41l4 4 23-24v-4h-4Z" fill="#f7e4ad" />
                <path
                  d="m18 38 9 9m19-9-9 9m-14-3-6 7m25-7 6 7"
                  stroke="#cdb675"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
                <path d="m32 29 5 5-5 5-5-5Z" fill="#fff2c0" />
              </svg>
            </span>
            <span className="hub-corner-mode-copy">
              <small>GAME MODE</small>
              <strong>SOLO</strong>
              <span>
                VS {BOT_LEVELS[botLevel].name.toUpperCase()} · LV{botLevel}
              </span>
              <span>
                {selectedMarket
                  ? `${selectedMarket.symbol} · ${selectedMarket.open ? 'OPEN' : 'CLOSED'}`
                  : 'CHOOSE ASSET'}
              </span>
            </span>
            <span className="hub-corner-mode-info" aria-hidden="true">
              i
            </span>
            <svg
              className="hub-corner-mode-chevron"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="m5 12 5-5 5 5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </summary>
          <div className="hub-corner-modes">
            <span>CHOOSE YOUR BATTLE</span>
            <div className="hub-mode-options">
              <button
                type="button"
                className="is-active"
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open');
                }}
              >
                <PlayIcon name="lobby" />
                <span>
                  <strong>SOLO</strong>
                  <small>You vs Bot</small>
                </span>
                <i>✓</i>
              </button>
              <button type="button" disabled>
                <LockIcon />
                <span>
                  <strong>PvP</strong>
                  <small>Coming soon</small>
                </span>
                <LockIcon />
              </button>
            </div>
            <BotSelector
              value={botLevel}
              levels={activeBots.levels}
              disabled={battleBusy}
              onChange={(level) => {
                audio.ui();
                setBotLevel(level);
              }}
            />
            <MarketSelector
              items={assets}
              value={selectedMarket}
              loading={markets.isPending}
              error={markets.isError}
              disabled={battleBusy}
              onRetry={() => void markets.refetch()}
              onChange={(assetId) => {
                audio.ui();
                setSelectedAssetId(assetId);
              }}
            />
          </div>
        </details>
        <Link
          href="/arena"
          className="hub-battle-button hub-corner-play"
          aria-busy={battleBusy}
          onClick={(event) => {
            event.preventDefault();
            void battle();
          }}
        >
          <span className="hub-corner-play-caption" aria-live="polite">
            <i />{' '}
            {loggedIn
              ? `${selectedMarket?.symbol ?? 'SELECT ASSET'} · VS ${BOT_LEVELS[botLevel].name.toUpperCase()} · 30 SEC`
              : 'CONNECT YOUR WALLET TO PLAY'}
          </span>
          <span className="hub-corner-play-label">{loggedIn ? 'BATTLE' : 'CONNECT'}</span>
          <svg className="hub-corner-play-spark" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m12 0 3 9 9 3-9 3-3 9-3-9-9-3 9-3Z" fill="currentColor" />
          </svg>
        </Link>
      </footer>
      {launch && <MenuLightFlight launch={launch} onArrive={() => setLobbyPanel(launch.panel)} />}
      <dialog
        ref={dialog}
        className="hub-dialog"
        data-panel={panel ?? undefined}
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          dismiss();
        }}
        onClose={() => {
          if (panel) dismiss();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) dismiss();
        }}
      >
        <div className="hub-dialog-inner">
          <h2 className="sr-only" id={titleId}>
            {panel === 'history'
              ? 'History Match'
              : panel === 'store'
                ? 'Character store'
                : 'Season leaderboard'}
          </h2>
          <button
            type="button"
            className="hub-dialog-close"
            aria-label="Close popup"
            onClick={dismiss}
          >
            <span>×</span>
          </button>
          <div className="hub-dialog-scroll">
            {panel === 'history'
              ? history
              : panel === 'leaderboard'
                ? leaderboard
                : panel === 'store'
                  ? store
                  : null}
          </div>
        </div>
      </dialog>
    </main>
  );
}
