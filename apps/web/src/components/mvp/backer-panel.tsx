'use client';
import { STABLE_DECIMALS, VAULTS } from '@hairto-arena/shared';
import { useState } from 'react';
import { parseUnits } from '@/lib/amount';
import { featureReady } from '@/lib/features';
import { formatAmount, useBalances } from '@/hooks/use-balances';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { ClaimList } from './claim-list';
import { FightersTable } from './fighters-table';
import { TxMessage, useTx, WalletBar } from './wallet-bar';
const fmt = (value: bigint | undefined) => value === undefined ? '—' : formatAmount(value, STABLE_DECIMALS);
export function BackerPanel() {
  const { accountId: address } = useWalletSession();
  const balances = useBalances();
  const tx = useTx();
  const [amount, setAmount] = useState(String(VAULTS.backer.minDepositUsd));
  // near-web-economy replaces these unavailable read/write results.
  const seasonId = 0n;
  const principal = undefined as bigint | undefined;
  const claimable = undefined as bigint | undefined;
  const wallet = balances.usdc;
  const pickedFighter = null as string | null;
  const pickOpen = false;
  const eligible = false;
  let parsed = 0n;
  try { parsed = parseUnits(amount || '0', STABLE_DECIMALS); } catch { parsed = 0n; }
  const deposit = () => tx.run('Deposit');
  return (
    <div className="space-y-6">
      <WalletBar />
      {!featureReady('economy') && <p className="text-sm text-white/60">Backer actions are not available yet.</p>}
      {address && (
        <>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Vault B</h2>
            <dl className="grid grid-cols-2 gap-1 text-sm sm:max-w-md">
              <dt className="text-white/60">Wallet USDC</dt>
              <dd>{fmt(wallet)}</dd>
              <dt className="text-white/60">Deposited</dt>
              <dd>{fmt(principal)}</dd>
              <dt className="text-white/60">Claimable yield</dt>
              <dd>{fmt(claimable)}</dd>
              <dt className="text-white/60">Minimum to pick</dt>
              <dd>{VAULTS.backer.minDepositUsd} USDC</dd>
            </dl>
            <p className="text-xs text-white/50">
              A wallet is either a Fighter (Vault A) or a Backer (Vault B), never both. Principal
              can always be withdrawn.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="w-28 rounded border border-white/20 bg-transparent px-2 py-1"
                value={amount}
                inputMode="decimal"
                onChange={(e) => setAmount(e.target.value)}
              />
              <button
                type="button"
                className="rounded bg-white px-3 py-1 text-black disabled:opacity-40"
                disabled={!featureReady('economy') || tx.busy !== null || parsed === 0n}
                onClick={() => void deposit()}
              >
                Deposit
              </button>
              <button
                type="button"
                className="rounded border border-white/30 px-3 py-1 disabled:opacity-40"
                disabled={!featureReady('economy') || tx.busy !== null || parsed === 0n || parsed > (principal ?? 0n)}
                onClick={() =>
                  void tx.run('Withdraw')
                }
              >
                Withdraw
              </button>
              <button
                type="button"
                className="rounded border border-white/30 px-3 py-1 disabled:opacity-40"
                disabled={!featureReady('economy') || tx.busy !== null || !claimable}
                onClick={() =>
                  void tx.run('Claim yield')
                }
              >
                Claim yield
              </button>
              <button
                type="button"
                className="rounded border border-white/30 px-3 py-1 disabled:opacity-40"
                disabled={!featureReady('economy') || tx.busy !== null}
                onClick={() =>
                  void tx.run('Faucet')
                }
              >
                Faucet +1,000 USDC
              </button>
            </div>
            <TxMessage tx={tx} />
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Pick a Fighter</h2>
            <p className="text-sm text-white/70">
              Season {seasonId.toString()} ·{' '}
              {pickedFighter
                ? `you picked ${pickedFighter}`
                : pickOpen
                  ? eligible
                    ? 'the pick window is open'
                    : `deposit at least ${VAULTS.backer.minDepositUsd} USDC to pick`
                  : 'the pick window is closed'}
            </p>
            <FightersTable
              picked={pickedFighter}
              pickDisabled={!pickOpen || !eligible || !!pickedFighter || tx.busy !== null}
              onPick={() =>
                void tx.run('Pick')
              }
            />
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Claims</h2>
            <ClaimList />
          </section>
        </>
      )}
    </div>
  );
}
