'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { shortAddress } from './wallet-bar';

interface FighterItem {
  address: string;
  points: number;
  duels: number;
  wins: number;
  backerCount: number;
}

interface FighterPage {
  items: FighterItem[];
  season: { id: number } | null;
}

/** Fighters of the current season by points. With `onPick`, each row gets a Pick button. */
export function FightersTable({
  onPick,
  pickDisabled,
  picked,
}: {
  onPick?: (fighter: string) => void;
  pickDisabled?: boolean;
  picked?: string | null;
}) {
  const fighters = useQuery({
    queryKey: ['mvp-fighters'],
    queryFn: ({ signal }) => api<FighterPage>('/fighters?limit=50&sort=points', { signal }),
    refetchInterval: 10_000,
  });

  if (fighters.isLoading) return <p className="text-sm text-white/60">Loading fighters…</p>;
  if (fighters.isError)
    return <p className="text-sm text-red-300">{(fighters.error as Error).message}</p>;
  const items = fighters.data?.items ?? [];
  if (items.length === 0) return <p className="text-sm text-white/60">No fighters yet.</p>;

  return (
    <table className="w-full text-left text-sm">
      <thead className="text-white/50">
        <tr>
          <th>#</th>
          <th>Fighter</th>
          <th>Points</th>
          <th>Duels</th>
          <th>Wins</th>
          <th>Backers</th>
          {onPick && <th />}
        </tr>
      </thead>
      <tbody>
        {items.map((f, i) => (
          <tr key={f.address} className="border-t border-white/10">
            <td>{i + 1}</td>
            <td className="font-mono" title={f.address}>
              {shortAddress(f.address)}
            </td>
            <td>{f.points}</td>
            <td>{f.duels}</td>
            <td>{f.wins}</td>
            <td>{f.backerCount}</td>
            {onPick && (
              <td>
                {picked === f.address ? (
                  <span className="text-emerald-300">picked</span>
                ) : (
                  <button
                    type="button"
                    className="rounded bg-white px-3 py-1 text-black disabled:opacity-40"
                    disabled={pickDisabled}
                    onClick={() => onPick(f.address)}
                  >
                    Pick
                  </button>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
