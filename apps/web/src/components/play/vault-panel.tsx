'use client';

import { QuickPlayControls } from './quick-play-controls';
import { STABLE_DECIMALS } from '@hairto-arena/shared';
import { useEffect, useId, useRef } from 'react';
import { formatAmount } from '@/hooks/use-balances';
import { useGameAssets } from '@/hooks/use-game-assets';
import { useVault } from '@/hooks/use-vault';

const fmt = (v: bigint) => formatAmount(v, STABLE_DECIMALS);

/**
 * Details behind the USDC chip: total assets (deposit, yield and prizes) and the wallet's own USDC. The faucet is
 * its own button; deposit and withdraw live in `VaultDialog`.
 */
export function VaultPanel({ onClose }: { onClose: () => void }) {
  const vault = useVault();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const assets = useGameAssets();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Element;
      if (!panel.current?.contains(target) && !target.closest('.hub-currency-usdc')) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [onClose]);

  return (
    <div ref={panel} className="hub-vault-panel" role="dialog" aria-labelledby={titleId}>
      <h2 id={titleId} className="sr-only">
        USDC and Vault A
      </h2>
      <dl className="hub-vault-rows">
        <div>
          <dt>Total assets</dt>
          <dd>{fmt(assets.total)} USDC</dd>
        </div>
        <div>
          <dt>Deposited (Vault A)</dt>
          <dd className={vault.canPlay ? '' : 'is-short'}>{fmt(vault.principal)} USDC</dd>
        </div>
        <div>
          <dt>Yield earned</dt>
          <dd>{fmt(assets.yieldEarned)} USDC</dd>
        </div>
        <div>
          <dt>Prizes to claim</dt>
          <dd>{fmt(assets.prizes)} USDC</dd>
        </div>
        <div>
          <dt>Wallet</dt>
          <dd>{fmt(vault.wallet)} USDC</dd>
        </div>
      </dl>
      <QuickPlayControls />
      <a href="/claim" className="hub-vault-link">
        Claim prizes
      </a>
    </div>
  );
}
