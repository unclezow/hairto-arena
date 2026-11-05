'use client';
import { STABLE_DECIMALS } from '@hairto-arena/shared';
import { formatAmount } from '@/hooks/use-balances';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { featureReady } from '@/lib/features';
import { TxMessage, useTx } from './wallet-bar';
interface ClaimRow { seasonId: number; kind: 'PRIZE' | 'BONUS'; rank: number | null; amount: string; proof: string[]; claimed: boolean; open: boolean }
export function ClaimList() {
  const { token } = useWalletSession();
  const tx = useTx();
  const list: ClaimRow[] = [];
  if (!token) return <p className="text-sm text-white/60">Sign in to see your claims.</p>;
  if (!featureReady('economy')) return <p className="text-sm text-white/60">Claims are not available yet.</p>;
  return (
    <div className="space-y-2">
      <table className="w-full text-left text-sm">
        <thead className="text-white/50">
          <tr>
            <th>Season</th>
            <th>Type</th>
            <th>Rank</th>
            <th>Amount</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={`${r.seasonId}-${r.kind}`} className="border-t border-white/10">
              <td>{r.seasonId}</td>
              <td>{r.kind === 'PRIZE' ? 'Fighter prize' : 'Backer bonus'}</td>
              <td>{r.rank ?? '-'}</td>
              <td>{formatAmount(BigInt(r.amount), STABLE_DECIMALS)} USDC</td>
              <td>
                {r.claimed ? (
                  <span className="text-white/50">claimed</span>
                ) : !r.open ? (
                  <span className="text-white/50">dispute window</span>
                ) : (
                  <button
                    type="button"
                    className="rounded bg-white px-3 py-1 text-black disabled:opacity-50"
                    disabled={!featureReady('economy') || tx.busy !== null}
                    onClick={() =>
                      void tx.run(`Claim season ${r.seasonId}`)
                    }
                  >
                    Claim
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <TxMessage tx={tx} />
    </div>
  );
}
