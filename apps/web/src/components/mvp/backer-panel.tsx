'use client';
import { STABLE_DECIMALS, VAULTS } from '@hairto-arena/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { parseUnits } from '@/lib/amount';
import { formatAmount } from '@/hooks/use-balances';
import { useVault } from '@/hooks/use-vault';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { useNearWallet } from '@/lib/near/context';
import { eventsOf, findEvent } from '@/lib/near/outcome';
import { arenaCall } from '@/lib/near/quick-play-key';
import { seasonViews } from '@/lib/near/season';
import { ClaimList } from './claim-list';
import { FightersTable } from './fighters-table';
import { TxMessage, useTx, WalletBar } from './wallet-bar';

const fmt = (value: bigint | undefined) => (value === undefined ? '—' : formatAmount(value, STABLE_DECIMALS));
const PICK_GAS_TGAS = 100;

const PICK_REJECTIONS: Record<string, string> = {
  not_eligible_backer: `Deposit at least ${VAULTS.backer.minDepositUsd} USDC to pick`,
  not_a_fighter: 'That account is not a Fighter',
  vault_error: 'Try again',
};

const countdown = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
};

/** The Backer flow: Get USDC, deposit into the Backer pool, pick a Fighter, claim yield and the season bonus. */
export function BackerPanel() {
  const { accountId: address } = useWalletSession();
  const { config, accountId, wallet } = useNearWallet();
  const queries = useQueryClient();
  const vault = useVault('Backer');
  const tx = useTx();
  const [amount, setAmount] = useState(String(VAULTS.backer.minDepositUsd));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const season = useQuery({
    queryKey: ['backer-season', config.contracts.arena, accountId],
    enabled: !!accountId,
    refetchInterval: 5000,
    queryFn: async () => {
      const views = seasonViews(config);
      const id = await views.currentSeason();
      if (!id) return { id, view: null, picked: null };
      const [view, picked] = await Promise.all([views.getSeason(id), views.pickOf(id, accountId!)]);
      return { id, view, picked };
    },
  });
  const seasonId = season.data?.id ?? 0;
  const pickEnd = season.data?.view?.pick_end_ms ?? 0;
  const pickOpen = season.data?.view?.phase === 'Picking' && now < pickEnd;
  const pickedFighter = season.data?.picked ?? null;
  const eligible = vault.eligible;

  let parsed = 0n;
  try {
    parsed = parseUnits(amount || '0', STABLE_DECIMALS);
  } catch {
    parsed = 0n;
  }
  const action = (ok: () => Promise<boolean>) => async () => ((await ok()) ? null : (vault.error ?? 'Not done'));

  const pick = (fighter: string) =>
    tx.run('Pick', async () => {
      if (!accountId || !wallet) return 'Sign in first';
      const outcome = await arenaCall(config, accountId, wallet, 'pick', { fighter }, { gasTgas: PICK_GAS_TGAS });
      const events = eventsOf(outcome, config.contracts.arena);
      await queries.invalidateQueries({ queryKey: ['backer-season'] });
      const rejected = findEvent(events, 'pick_rejected');
      if (rejected) return PICK_REJECTIONS[rejected.reason] ?? 'The arena refused the pick';
      return findEvent(events, 'picked') ? null : 'The pick was not confirmed';
    });

  return (
    <div className="space-y-6">
      <WalletBar />
      {address && (
        <>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Backer pool</h2>
            <dl className="grid grid-cols-2 gap-1 text-sm sm:max-w-md">
              <dt className="text-white/60">Wallet USDC</dt>
              <dd>{fmt(vault.wallet)}</dd>
              <dt className="text-white/60">Deposited</dt>
              <dd>{fmt(vault.principal)}</dd>
              <dt className="text-white/60">Claimable yield</dt>
              <dd>{fmt(vault.yieldEarned)}</dd>
              <dt className="text-white/60">Minimum to pick</dt>
              <dd>{VAULTS.backer.minDepositUsd} USDC</dd>
            </dl>
            <p className="text-xs text-white/50">
              An account is either a Fighter or a Backer, never both. Principal can always be withdrawn.
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
                disabled={tx.busy !== null || parsed === 0n || parsed > vault.wallet}
                onClick={() => void tx.run('Deposit', action(() => vault.deposit(parsed)))}
              >
                Deposit
              </button>
              <button
                type="button"
                className="rounded border border-white/30 px-3 py-1 disabled:opacity-40"
                disabled={tx.busy !== null || parsed === 0n || parsed > vault.principal}
                onClick={() => void tx.run('Withdraw', action(() => vault.withdraw(parsed)))}
              >
                Withdraw
              </button>
              <button
                type="button"
                className="rounded border border-white/30 px-3 py-1 disabled:opacity-40"
                disabled={tx.busy !== null || vault.yieldEarned === 0n}
                onClick={() => void tx.run('Claim yield', action(() => vault.claimYield()))}
              >
                Claim yield
              </button>
              <button
                type="button"
                className="rounded border border-white/30 px-3 py-1 disabled:opacity-40"
                disabled={tx.busy !== null || vault.nextClaimAt * 1000 > now}
                onClick={() => void tx.run('Faucet', action(() => vault.claim()))}
              >
                Faucet +1,000 USDC
              </button>
            </div>
            <TxMessage tx={tx} />
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Pick a Fighter</h2>
            <p className="text-sm text-white/70">
              Season {seasonId} ·{' '}
              {pickedFighter
                ? `you picked ${pickedFighter}`
                : pickOpen
                  ? eligible
                    ? `the pick window is open · closes in ${countdown(pickEnd - now)}`
                    : `deposit at least ${VAULTS.backer.minDepositUsd} USDC to pick`
                  : 'the pick window is closed'}
            </p>
            <FightersTable
              picked={pickedFighter}
              pickDisabled={!pickOpen || !eligible || !!pickedFighter || tx.busy !== null}
              onPick={(fighter) => void pick(fighter)}
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
