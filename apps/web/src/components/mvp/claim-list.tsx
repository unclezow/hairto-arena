'use client';
import { STABLE_DECIMALS } from '@hairto-arena/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatAmount } from '@/hooks/use-balances';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { api, ApiError } from '@/lib/api';
import { useNearWallet } from '@/lib/near/context';
import { economyViews } from '@/lib/near/economy';
import { eventsOf, findEvent } from '@/lib/near/outcome';
import { hexProofToBase64, seasonViews } from '@/lib/near/season';
import { walletSend, type WalletCall } from '@/lib/near/tx';
import { TxMessage, useTx } from './wallet-bar';

interface ApiResult {
  seasonId: number;
  kind: 'PRIZE' | 'BONUS';
  rank: number | null;
  amount: string;
  proof: string[];
}
interface ClaimRow extends ApiResult {
  claimed: boolean;
  open: boolean;
  opensMs: number | null;
}

/** Seasons looked at, newest first. The API answers 404 for a season without a result for this account. */
const LOOKBACK = 6;
const CLAIM_GAS_TGAS = 50;

/** Fighter prizes and Backer bonuses of the signed-in account, with a claim button once the arena pays. */
export function ClaimList() {
  const { accountId: address, token } = useWalletSession();
  const { config, accountId, wallet } = useNearWallet();
  const queries = useQueryClient();
  const tx = useTx();

  const rows = useQuery({
    queryKey: ['claims', address, token],
    enabled: !!address && !!token,
    refetchInterval: 8000,
    queryFn: async (): Promise<ClaimRow[]> => {
      const views = seasonViews(config);
      const current = await views.currentSeason();
      const out: ClaimRow[] = [];
      for (let id = current; id >= Math.max(1, current - LOOKBACK + 1); id--) {
        let result: ApiResult;
        try {
          result = await api<ApiResult>(`/seasons/${id}/results/${address}`);
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) continue;
          throw err;
        }
        const kind = result.kind === 'PRIZE' ? 'Prize' : 'Bonus';
        const [season, claimed] = await Promise.all([views.getSeason(id), views.isClaimed(id, kind, address!)]);
        const results = season?.results ?? null;
        out.push({
          ...result,
          seasonId: id,
          claimed,
          open: season?.phase === 'Finalized' && !!results && !results.rolled_over,
          opensMs: results?.claim_opens_ms ?? null,
        });
      }
      return out;
    },
  });

  const claim = (r: ClaimRow) =>
    tx.run(`Claim season ${r.seasonId}`, async () => {
      if (!accountId || !wallet) return 'Sign in first';
      const token = economyViews(config);
      const calls: WalletCall[] = [];
      // The payout is a USDC transfer: an account that never held USDC registers in the same approval.
      if (!(await token.usdcRegistered(accountId)))
        calls.push({
          receiverId: config.contracts.usdc,
          method: 'storage_deposit',
          args: {},
          gasTgas: 30,
          deposit: await token.usdcStorageMin(),
        });
      calls.push({
        receiverId: config.contracts.arena,
        method: r.kind === 'PRIZE' ? 'claim_prize' : 'claim_bonus',
        args: { season: r.seasonId, amount: r.amount, proof: hexProofToBase64(r.proof) },
        gasTgas: CLAIM_GAS_TGAS,
        deposit: '0',
      });
      const outcomes = await walletSend(config, accountId, wallet, calls);
      await queries.invalidateQueries({ queryKey: ['claims'] });
      const events = outcomes.flatMap((o) => eventsOf(o, config.contracts.arena));
      if (findEvent(events, 'claim_failed')) return 'Payout failed, you can claim again';
      return findEvent(events, 'prize_claimed') || findEvent(events, 'bonus_claimed') ? null : 'The claim was not confirmed';
    });

  if (!token) return <p className="text-sm text-white/60">Sign in to see your claims.</p>;
  if (rows.isLoading) return <p className="text-sm text-white/60">Looking for results…</p>;
  if (rows.isError) return <p className="text-sm text-red-300">{(rows.error as Error).message}</p>;
  const list = rows.data ?? [];
  if (list.length === 0)
    return (
      <p className="text-sm text-white/60">
        Nothing to claim yet. Results appear after a season is closed and the keeper has posted them.
      </p>
    );
  const now = Date.now();

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
                  <span className="text-white/50">
                    dispute window
                    {r.opensMs && r.opensMs > now ? ` · ${Math.ceil((r.opensMs - now) / 60_000)} min` : ''}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="rounded bg-white px-3 py-1 text-black disabled:opacity-50"
                    disabled={tx.busy !== null}
                    onClick={() => void claim(r)}
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
