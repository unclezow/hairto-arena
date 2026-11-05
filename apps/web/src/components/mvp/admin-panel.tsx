'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWalletSession } from '@/hooks/use-wallet-session';
import { api } from '@/lib/api';
import { viewClient } from '@/lib/near/client';
import { useNearWallet } from '@/lib/near/context';
import { seasonViews } from '@/lib/near/season';
import { walletSend } from '@/lib/near/tx';
import { TxMessage, useTx, WalletBar } from './wallet-bar';

const at = (ms: number) => (ms ? new Date(ms).toLocaleString() : '-');
const MINUTE_MS = 60_000;
/** Demo boost for the mock yield (multiplier on the vault clock). */
const BOOST_MULTIPLIER = 100_000;
interface Flag { name: string; value: boolean | string }

/** Operator actions, signed by the connected wallet (it must hold the operator role on the arena and the vault). */
export function AdminPanel() {
  const { token } = useWalletSession();
  const { config, accountId, wallet } = useNearWallet();
  const queryClient = useQueryClient();
  const tx = useTx();
  const views = seasonViews(config);
  const season = useQuery({
    queryKey: ['admin-season', config.contracts.arena],
    refetchInterval: 5000,
    queryFn: async () => {
      const id = await views.currentSeason();
      return { id, view: id ? await views.getSeason(id) : null };
    },
  });
  const current = season.data?.id ?? 0;
  const view = season.data?.view ?? null;
  const phase = view?.phase ?? 'None';
  const running = phase === 'Picking' || phase === 'Active';
  const canEndNow = running;
  const canClose = running && !!view && Date.now() >= view.end_ms;

  /** One operator call through the wallet; a contract panic (missing role, wrong phase) is shown as the error. */
  const operator = (receiverId: string, method: string, args: object) => async () => {
    if (!accountId || !wallet) return 'Connect the operator wallet';
    await walletSend(config, accountId, wallet, [{ receiverId, method, args, gasTgas: 50, deposit: '0' }]);
    await queryClient.invalidateQueries({ queryKey: ['admin-season'] });
    return null;
  };
  const startSeason = () =>
    tx.run('Start season', async () => {
      const assets = await viewClient(config).view<{ asset_id: number; active: boolean }[]>(config.contracts.arena, 'get_assets', {});
      const ids = (assets ?? []).filter((a) => a.active).map((a) => a.asset_id);
      return operator(config.contracts.arena, 'start_season', { asset_ids: ids })();
    });
  // Short demo season: 30 minutes with a 15 minute pick window, so Backers have time to pick. Other windows 1 minute.
  const demoDurations = () =>
    tx.run(
      'Demo durations',
      operator(config.contracts.arena, 'set_durations', {
        season_duration_ms: 30 * MINUTE_MS,
        pick_window_ms: 15 * MINUTE_MS,
        dispute_window_ms: MINUTE_MS,
        close_delay_ms: MINUTE_MS,
        claim_period_ms: 60 * MINUTE_MS,
      }),
    );
  // The mock yield earns almost nothing at real speed; speeding up the vault clock gives the pot something.
  const boostYield = () =>
    tx.run('Boost yield', operator(config.contracts.vault, 'set_time_multiplier', { multiplier: BOOST_MULTIPLIER }));
  const harvest = () =>
    tx.run('Harvest', async () => {
      await api('/admin/keeper/harvest', { method: 'POST' });
      return null;
    });
  const flags = useQuery<Flag[]>({ queryKey: ['mvp-admin-flags', token], enabled: !!token, queryFn: () => api<Flag[]>('/admin/flags') });
  const status = useQuery<{ components: { indexer?: { lagBlocks?: number; maxForKeeper?: number } } }>({
    queryKey: ['mvp-admin-status', token],
    enabled: !!token,
    refetchInterval: 10_000,
    queryFn: () => api('/admin/status'),
  });
  const keeperOn = flags.data?.find((flag) => flag.name === 'KEEPER_ENABLED')?.value === true && flags.data?.find((flag) => flag.name === 'KEEPER_DRY_RUN')?.value === false;
  const toggleKeeper = useMutation({
    mutationFn: async () => {
      // On means live: enabled and not a dry run.
      await api('/admin/flags/KEEPER_ENABLED', { method: 'PUT', body: JSON.stringify({ value: !keeperOn }) });
      await api('/admin/flags/KEEPER_DRY_RUN', { method: 'PUT', body: JSON.stringify({ value: false }) });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mvp-admin-flags'] }),
  });
  const indexer = status.data?.components.indexer;
  const button = (label: string, onClick: () => void, enabled: boolean, primary = true) => (
    <button type="button" className={`rounded px-3 py-1 disabled:opacity-40 ${primary ? 'bg-white text-black' : 'border border-white/30'}`} disabled={tx.busy !== null || !enabled} onClick={onClick}>{label}</button>
  );
  return (
    <div className="space-y-6">
      <WalletBar />

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Season {current}</h2>
        {view && current > 0 ? (
          <p className="text-sm">
            {phase} · ends {at(view.end_ms)}
            {view.results && ` · claims open ${at(view.results.claim_opens_ms)}`}
          </p>
        ) : (
          <p className="text-sm text-white/60">No season yet.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {button('Start new season', () => void startSeason(), current === 0 || !running)}
          {button(
            'End season now',
            () => void tx.run('End season now', operator(config.contracts.arena, 'end_season_now', {})),
            canEndNow,
          )}
          {button(
            'Close season',
            () => void tx.run('Close season', operator(config.contracts.arena, 'close_season', {})),
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
