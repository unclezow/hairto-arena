'use client';

import { VAULTS } from '@hairto-arena/shared';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useLogin, useLogout } from '@/hooks/use-login';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { useBalances } from '@/hooks/use-balances';
import { useQuickPlayKey } from '@/hooks/use-quick-play-key';
import { useNearWallet } from '@/lib/near/context';
import { api } from '@/lib/api';
import { onboardingProgress, reviewedStep, roleDestination, quickPlayPromptSeen, type PlayerRole } from '@/lib/onboarding';
import { formatUnits } from '@/lib/amount';
import { ProfilePortrait } from './player-profile';
import { QuickPlayPrompt } from './quick-play-prompt';
import './connect-modal.css';

type Role = 'fighter' | 'backer';
const ROLES: { id: Role; title: string; minimum: number; task: string }[] = [
  {
    id: 'fighter',
    title: 'FIGHTER',
    minimum: VAULTS.fighter.minDepositUsd,
    task: 'Duel a bot on real asset prices and climb the season ranking.',
  },
  {
    id: 'backer',
    title: 'BACKER',
    minimum: VAULTS.backer.minDepositUsd,
    task: 'Back a Fighter and share the season bonus.',
  },
];

/** Hooded patron with a gold coin, drawn to match the Fighter portraits. */
function BackerPortrait() {
  return (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true">
      <path d="M0 0h80v80H0Z" fill="#1e3930" />
      <path d="M0 67 67 0M19 83 83 19" stroke="#f5dfa4" strokeOpacity=".07" strokeWidth="12" />
      <path d="M10 80V66l20-13h20l20 13v14Z" fill="#7a5a34" />
      <path d="m16 70 24-9 24 9" stroke="#d9c18a" strokeWidth="3" />
      <path d="M22 30c0-18 36-18 36 0v15c0 12-8 19-18 19s-18-7-18-19Z" fill="#e2c19a" />
      <path
        d="M17 38C14 14 28 5 40 5s26 9 23 33l-7-9c-6-4-26-4-32 0Z"
        fill="#3d5a3a"
        stroke="#9fa86a"
      />
      <path d="M31 38h4m10 0h4" stroke="#20312a" strokeWidth="3" strokeLinecap="round" />
      <path d="M35 50q5 3 10 0" stroke="#8a5a3c" strokeWidth="2" strokeLinecap="round" />
      <circle cx="62" cy="58" r="11" fill="#e8c35a" stroke="#fff0bd" strokeWidth="2" />
      <path
        d="M62 52v12m-4-9h6a2.5 2.5 0 0 1 0 5h-5"
        stroke="#8a6a1c"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}


export function ConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <ConnectModalBody onClose={onClose} /> : null;
}

function ConnectModalBody({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const login = useLogin();
  const logout = useLogout();
  const session = useWalletSession();
  const { config, connector, error: connectorError } = useNearWallet();
  const balances = useBalances(5_000);
  const quick = useQuickPlayKey();
  const [picked, setPicked] = useState<Role | null>(null);
  const [completedRole, setCompletedRole] = useState<Role | null>(null);
  const [review, setReview] = useState<number | null>(null);
  const [changing, setChanging] = useState(false);
  const [copyState, setCopyState] = useState('');
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const me = useQuery({
    queryKey: ['me-status', session.accountId, session.token],
    queryFn: ({ signal }) => api<{ role: PlayerRole }>('/me/status?live=true', { signal }),
    enabled: !!session.token,
  });
  const role = completedRole ?? me.data?.role;
  const progress = onboardingProgress({
    connected: session.isConnected,
    verified: !!session.token,
    nearBalance: balances.nearQuery.data,
    role,
  });
  const step = reviewedStep(progress, review);
  const reviewing = review !== null && review < progress;
  const promptSeen = session.accountId ? quickPlayPromptSeen(config.network, session.accountId) : false;
  const showQuick = progress === 5 && !reviewing && !!quick.status.data && quick.status.data.kind !== 'active' && !promptSeen;
  const finishFlow = () => {
    onClose();
    router.push(roleDestination(role ?? 'fighter'));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    root.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (progress !== 5 || reviewing || !quick.status.data) return;
    if (quick.status.data.kind !== 'active' && !promptSeen) return;
    onClose();
    router.push(roleDestination(role ?? 'fighter'));
  }, [progress, reviewing, quick.status.data, promptSeen, onClose, router, role]);

  const goBack = (to: number) => { setPicked(null); setReview(to); };
  const changeWallet = async () => {
    setChanging(true);
    try {
      await logout();
      setPicked(null);
      setCompletedRole(null);
      setReview(null);
      await login();
    } finally { setChanging(false); }
  };
  const finish = () => { if (picked) setCompletedRole(picked); };
  const heading = reviewing ? (step === 1 ? 'WALLET CONNECTED' : step === 2 ? 'WALLET VERIFIED' : step === 3 ? 'ACCOUNT FUNDED' : 'ROLE SELECTED')
    : step === 1 ? 'CONNECT WALLET' : step === 2 ? 'VERIFY WALLET' : step === 3 ? 'FUND YOUR ACCOUNT' : progress === 5 ? 'QUICK PLAY' : 'CHOOSE YOUR ROLE';
  const shortAddress = session.accountId ?? '';
  const copyAccount = async () => {
    try { await navigator.clipboard.writeText(shortAddress); setCopyState('Account ID copied'); }
    catch { setCopyState('Could not copy account ID'); }
  };

  return (
    <div className="connect-overlay" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={root} className="connect-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button type="button" className="connect-close" onClick={onClose} aria-label="Close">×</button>
        <ol className="connect-steps" aria-label="Connect progress">
          {['Connect', 'Verify', 'Fund', 'Role'].map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined} className={progress > index + 1 ? 'is-done' : ''}>
            {progress > index + 1 && step !== index + 1 ? <button type="button" className="connect-step-back" onClick={() => goBack(index + 1)} aria-label={`Back to step ${index + 1}: ${label}`}>{label}</button> : label}
          </li>)}
        </ol>
        {showQuick ? <div id={titleId} className="connect-quick-play"><QuickPlayPrompt onDone={finishFlow} /></div> : <>
          <h2 id={titleId}>{heading}</h2>
          {reviewing && <>
            <p className="connect-note connect-note-center">{step === 1 ? `Connected as ${shortAddress}.` : step === 2 ? `Signed in as ${shortAddress}. Your signature is saved for this session.` : `Your account has ${formatUnits(balances.near, 24)} NEAR for gas.`}</p>
            <button type="button" className="connect-primary" onClick={() => setReview(null)}>NEXT</button>
            {step === 1 && <button type="button" className="connect-link" disabled={changing} onClick={() => void changeWallet()}>Use a different wallet</button>}
          </>}
          {!reviewing && step === 1 && <>
            <p className="connect-note connect-note-center">Sign in with Google, email or your NEAR wallet. New here? You will pick a role next.</p>
            {(session.error || connectorError) && <p className="connect-error" role="alert">{session.error || connectorError}</p>}
            <button type="button" className="connect-primary" disabled={changing || !connector} onClick={() => void login()}>CONNECT</button>
          </>}
          {!reviewing && step === 2 && <>
            {session.status === 'failed' ? <>
              <p className="connect-error" role="alert">{session.error}</p>
              <button type="button" className="connect-primary" onClick={() => void session.signIn()}>TRY AGAIN</button>
            </> : !session.token && session.status === 'idle' ? <>
              <p className="connect-note connect-note-center">Wallet connected. Sign a message to log in.</p>
              <button type="button" className="connect-primary" onClick={() => void session.signIn()}>SIGN IN</button>
            </> : me.isError || balances.nearQuery.isError ? <>
              <p className="connect-error" role="alert">Could not check your account.</p>
              <button type="button" className="connect-primary" onClick={() => { void me.refetch(); void balances.nearQuery.refetch(); }}>TRY AGAIN</button>
            </> : <p className="connect-note connect-note-center" role="status">{session.status === 'signing' ? 'Sign the message in your wallet…' : 'Checking your account…'}</p>}
          </>}
          {!reviewing && step === 3 && <>
            <p className="connect-note connect-note-center">NEAR pays for gas and storage. Game funds are USDC (mock), available in the lobby.</p>
            <p className="connect-note connect-note-center" style={{ overflowWrap: 'anywhere' }}>{session.accountId}</p>
            <button type="button" className="connect-link" onClick={() => void copyAccount()}>Copy account ID</button>
            <p className="connect-note connect-note-center" role="status">{copyState || `Balance: ${formatUnits(balances.near, 24)} NEAR · Minimum: 0.05 NEAR`}</p>
            <a className="connect-primary" href="https://near-faucet.io" target="_blank" rel="noopener noreferrer">GET TESTNET NEAR</a>
            <p className="connect-note connect-note-fine">Waiting for funding… Balance updates every 5 seconds.</p>
            {balances.nearQuery.isError && <p className="connect-error" role="alert">Could not refresh your balance. Retrying…</p>}
          </>}
          {!reviewing && step === 4 && progress !== 5 && <>
            {/* Both cards stay mounted so the picked one can slide to the center. */}
            <div className={`connect-roles${picked ? ' is-picked' : ''}`}>
              {ROLES.map((r) => {
                const hidden = !!picked && r.id !== picked;
                return (
                  <button
                    key={r.id}
                    type="button"
                    className="connect-role"
                    data-role={r.id}
                    disabled={!!picked}
                    aria-hidden={hidden || undefined}
                    tabIndex={picked ? -1 : undefined}
                    data-hidden={hidden || undefined}
                    onClick={() => setPicked(r.id)}
                  >
                    <span className="connect-role-hero">
                      {r.id === 'fighter' ? <ProfilePortrait kind="Knight" /> : <BackerPortrait />}
                    </span>
                    <strong>{r.title}</strong>
                    <span className="connect-role-info">
                      <small>DEPOSIT</small>
                      <b>min. ${r.minimum}</b>
                    </span>
                    <span className="connect-role-info">
                      <small>TASK</small>
                      <span>{r.task}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {picked ? (
              <div className="connect-actions">
                <button type="button" className="connect-primary" onClick={finish}>
                  {picked === 'fighter' ? 'ENTER LOBBY' : 'CONTINUE'}
                </button>
                <button type="button" className="connect-link" onClick={() => setPicked(null)}>
                  Change role
                </button>
              </div>
            ) : (
              <p className="connect-note connect-note-fine">
                One wallet, one role. You can switch only after withdrawing everything.
              </p>
            )}
            {!picked && (
              <button type="button" className="connect-link" onClick={() => goBack(2)}>
                ‹ Back
              </button>
            )}

          </>}
          {!reviewing && progress === 5 && <p className="connect-note connect-note-center" role="status">{quick.status.isError ? 'Could not check quick play.' : 'Checking quick play…'}</p>}
          {!reviewing && progress === 5 && quick.status.isError && <button type="button" className="connect-primary" onClick={finishFlow}>CONTINUE</button>}
        </>}
        {!reviewing && step >= 2 && session.isConnected && <button type="button" className="connect-link" disabled={changing} onClick={() => void changeWallet()}>Use a different wallet</button>}
      </div>
    </div>
  );
}
