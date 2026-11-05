'use client';

import { useEffect, useState } from 'react';
import { featureReady } from '@/lib/features';
import { useVault } from '@/hooks/use-vault';

export function FaucetButton({
  loggedIn,
  onConnect,
  onClickSound,
}: {
  loggedIn: boolean;
  onConnect: () => void;
  onClickSound: () => void;
}) {
  const vault = useVault();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [claimed, setClaimed] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, vault.nextClaimAt - now);
  const coolingDown = loggedIn && seconds > 0;
  const busy = vault.busy !== null;
  const cooldown = `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  return (
    <div className="hub-faucet">
      <button
        type="button"
        className="hub-faucet-button"
        disabled={busy || coolingDown || (loggedIn && !featureReady('economy'))}
        aria-busy={busy}
        aria-label={
          coolingDown ? `Faucet ready in ${cooldown}` : 'Claim 1,000 test USDC from the faucet'
        }
        onClick={async () => {
          onClickSound();
          if (!loggedIn) {
            onConnect();
            return;
          }
          setClaimed(false);
          if (await vault.claim()) setClaimed(true);
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M5 5h14M12 2v5M6 5v5h9a4 4 0 0 1 4 4v2h-5v-2H6V5Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M18 19c0 3-4 3-4 0l2-3 2 3Z" fill="currentColor" />
        </svg>
        <strong>{busy ? 'CLAIMING…' : coolingDown ? cooldown : 'FAUCET'}</strong>
        {!busy && !coolingDown && <span>+1,000</span>}
      </button>
      <div className="hub-faucet-tooltip" role="status">
        {!featureReady('economy') ? 'USDC faucet is not available yet.' : vault.error
          ? `Claim failed: ${vault.error}`
          : claimed
            ? '1,000 USDC claimed!'
            : coolingDown
              ? `Next claim in ${cooldown}`
              : '1,000 test USDC · once per hour'}
      </div>
    </div>
  );
}
