'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { featureReady, featureUnavailable } from '@/lib/features';
import { TxMessage, useTx, WalletBar } from './wallet-bar';
const PHASES = ['None', 'Picking', 'Active', 'Closed', 'ResultsPosted', 'Finalized'] as const;
const at = (timestamp: number) => timestamp ? new Date(timestamp * 1000).toLocaleString() : '-';
interface Flag { name: string; value: boolean | string }
export function AdminPanel() {
  const { token } = useWalletSession();
  const tx = useTx();
  const current = 0n;
  const season = undefined as { endTs: number; resultsPostedAt: number; claimOpensAt: number } | undefined;
  const phase = 0;
  const running = false;
  const canEndNow = false;
  const canClose = false;
  const startSeason = () => tx.run('Start season');
  const demoDurations = () => tx.run('Demo durations');
  const boostYield = () => tx.run('Boost yield');
  const harvest = () => tx.run('Harvest');
  const flags = useQuery<Flag[]>({ queryKey: ['mvp-admin-flags', token], enabled: featureReady('economy') && !!token, queryFn: async () => featureUnavailable('economy') });
  const status = useQuery<{ components: { indexer?: { lagBlocks?: number; maxForKeeper?: number } } }>({ queryKey: ['mvp-admin-status', token], enabled: featureReady('economy') && !!token, queryFn: async () => featureUnavailable('economy') });
  const keeperOn = flags.data?.find((flag) => flag.name === 'KEEPER_ENABLED')?.value === true && flags.data?.find((flag) => flag.name === 'KEEPER_DRY_RUN')?.value === false;
  const toggleKeeper = useMutation({ mutationFn: async () => featureUnavailable('economy') });
  const indexer = status.data?.components.indexer;
  const button = (label: string, onClick: () => void, enabled: boolean, primary = true) => (
    <button type="button" className={`rounded px-3 py-1 disabled:opacity-40 ${primary ? 'bg-white text-black' : 'border border-white/30'}`} disabled={!featureReady('economy') || tx.busy !== null || !enabled} onClick={onClick}>{label}</button>
  );
  return (
    <div className="space-y-6">
      <WalletBar />
      {!featureReady('economy') && <p className="text-sm text-white/60">Admin actions are not available yet.</p>}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Season {current.toString()}</h2>
        {season && current > 0n ? (
          <p className="text-sm">
            {PHASES[phase] ?? phase} · ends {at(Number(season.endTs))}
            {season.resultsPostedAt > 0 && ` · claims open ${at(Number(season.claimOpensAt))}`}
          </p>
        ) : (
          <p className="text-sm text-white/60">No season yet.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {button('Start new season', () => void startSeason(), current === 0n || !running)}
          {button(
            'End season now',
            () =>
              void tx.run('End season now'),
            canEndNow,
          )}
          {button(
            'Close season',
            () =>
              void tx.run('Close season'),
            canClose,
          )}
        </div>
        <p className="text-xs text-white/50">
          End now moves the end to this moment; close works after the close delay. A new season can
          start once the last one is no longer running.
        </p>
        <TxMessage tx={tx} />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Demo helpers</h2>
        <div className="flex flex-wrap gap-2">
          {button('Short season durations', () => void demoDurations(), true, false)}
          {button('Boost mock yield', () => void boostYield(), true, false)}
          {button('Harvest into the pot', () => void harvest(), true, false)}
        </div>
        <p className="text-xs text-white/50">
          Durations apply to the next season. Boost the yield first, let some time pass, then
          harvest.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Keeper</h2>
        {!token ? (
          <p className="text-sm text-white/60">Sign in with the admin wallet.</p>
        ) : (
          <>
            <p className="text-sm">
              {keeperOn ? 'On: posts the results and rolls over by itself.' : 'Off.'}{' '}
              {indexer?.lagBlocks !== undefined &&
                `Indexer ${indexer.lagBlocks} blocks behind (the keeper waits above ${indexer.maxForKeeper}).`}
            </p>
            {button(
              keeperOn ? 'Turn keeper off' : 'Turn keeper on',
              () => toggleKeeper.mutate(),
              !toggleKeeper.isPending,
              false,
            )}
          </>
        )}
        {(flags.isError || toggleKeeper.isError) && (
          <p className="text-sm text-red-300">
            {((flags.error ?? toggleKeeper.error) as Error).message}
          </p>
        )}
      </section>
    </div>
  );
}
