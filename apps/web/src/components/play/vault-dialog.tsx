'use client';

import { STABLE_DECIMALS, VAULTS } from '@hairto-arena/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { formatUnits, parseUnits } from '@/lib/amount';
import { featureReady } from '@/lib/features';
import { formatAmount } from '@/hooks/use-balances';
import { FIGHTER_MINIMUM, useVault } from '@/hooks/use-vault';
import './connect-modal.css';
import './vault-dialog.css';

export type VaultMode = 'deposit' | 'withdraw';

const fmt = (v: bigint) => formatAmount(v, STABLE_DECIMALS);

/**
 * Deposit into or withdraw from Vault A, opened by the buttons next to the lobby's USDC chip. Every transaction here
 * is one the player asked for; BATTLE only opens it (with a notice) when the deposit is short.
 */
export function VaultDialog({
  mode: initialMode,
  notice,
  onClose,
}: {
  mode: VaultMode;
  notice: string | null;
  onClose: () => void;
}) {
  const vault = useVault();
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<VaultMode>(initialMode);
  const [amount, setAmount] = useState(() =>
    initialMode === 'deposit' ? String(VAULTS.fighter.minDepositUsd) : '',
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    root.current?.querySelector<HTMLElement>('input')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  let parsed: bigint | null = null;
  try {
    parsed = amount.trim() ? parseUnits(amount.trim(), STABLE_DECIMALS) : null;
  } catch {
    parsed = null;
  }
  const valid = parsed !== null && parsed > 0n;
  const busy = vault.busy !== null;
  const remaining = mode === 'withdraw' && valid ? vault.principal - parsed! : null;

  /** Why the action cannot run yet, or null when it can. */
  const problem = !featureReady('economy') ? 'Economy actions are not available yet.' : !valid
    ? 'Enter an amount.'
    : mode === 'deposit'
      ? parsed! > vault.wallet
        ? 'Not enough USDC in your wallet. Claim test USDC from the balance menu.'
        : vault.principal + parsed! < FIGHTER_MINIMUM
          ? `Vault A needs at least ${VAULTS.fighter.minDepositUsd} USDC to play.`
          : null
      : parsed! > vault.principal
        ? 'That is more than your Vault A deposit.'
        : null;

  const submit = async () => {
    if (!valid || problem) return;
    const ok = mode === 'deposit' ? await vault.deposit(parsed!) : await vault.withdraw(parsed!);
    if (ok) onClose();
  };
  const pick = (next: VaultMode) => {
    setMode(next);
    setAmount(next === 'deposit' ? String(VAULTS.fighter.minDepositUsd) : '');
  };
  const max = mode === 'deposit' ? vault.wallet : vault.principal;

  return (
    <div
      className="connect-overlay"
      onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        ref={root}
        className="connect-modal vault-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <button
          type="button"
          className="connect-close"
          onClick={onClose}
          disabled={busy}
          aria-label="Close"
        >
          ×
        </button>
        <h2 id={titleId}>{mode === 'deposit' ? 'DEPOSIT' : 'WITHDRAW'}</h2>
        <div className="vault-tabs" role="group" aria-label="Action">
          {(['deposit', 'withdraw'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              disabled={busy}
              onClick={() => pick(m)}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
        {notice && <p className="connect-error">{notice}</p>}
        <dl className="vault-rows">
          <div>
            <dt>Wallet</dt>
            <dd>{fmt(vault.wallet)} USDC</dd>
          </div>
          <div>
            <dt>Vault A deposit</dt>
            <dd className={vault.canPlay ? '' : 'is-short'}>{fmt(vault.principal)} USDC</dd>
          </div>
        </dl>
        <label className="vault-amount">
          <span className="sr-only">Amount in USDC</span>
          <input
            inputMode="decimal"
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            aria-invalid={amount !== '' && !!problem}
          />
          <span aria-hidden="true">USDC</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => setAmount(formatUnits(max, STABLE_DECIMALS))}
          >
            MAX
          </button>
        </label>
        {remaining !== null && remaining < FIGHTER_MINIMUM && !problem && (
          <p className="connect-note">
            You will have {fmt(remaining)} USDC left in Vault A. Below{' '}
            {VAULTS.fighter.minDepositUsd} USDC you cannot duel until you deposit again.
          </p>
        )}
        <p className="connect-note" role="status">
          {vault.error
            ? `Failed: ${vault.error}`
            : amount !== '' && problem
              ? problem
              : mode === 'deposit'
                ? 'Your deposit stays yours and can be withdrawn any time.'
                : 'Withdraw any time. Your principal is never locked.'}
        </p>
        <button
          type="button"
          className="connect-primary"
          disabled={busy || !valid || !!problem}
          aria-busy={busy}
          onClick={() => void submit()}
        >
          {busy ? 'CONFIRMING…' : mode === 'deposit' ? 'DEPOSIT' : 'WITHDRAW'}
        </button>
      </div>
    </div>
  );
}
