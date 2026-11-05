import type { ArenaEvents } from '@hairto-arena/shared';
import { eventId, txOf, writePosition, type IndexedEvent, type Row, type Store } from './store.js';

/** Roots arrive base64 from the arena; the read model keeps them as 64 hex, like the keeper computes them. */
const hexOf = (base64: string) => Buffer.from(base64, 'base64').toString('hex');

async function patchSeason(store: Store, id: bigint, patch: Row) {
  const existing = await store.find('season', { id });
  // Started before the indexer's start block: nothing to patch.
  if (!existing) return;
  await store.upsert('season', { id }, {}, () => patch);
}

export async function onSeasonStarted(
  ev: IndexedEvent<ArenaEvents['season_started']>,
  store: Store,
) {
  const { data } = ev;
  await store.upsert(
    'season',
    { id: BigInt(data.season) },
    {
      startMs: BigInt(data.start_ms),
      pickEndMs: BigInt(data.pick_end_ms),
      endMs: BigInt(data.end_ms),
      phase: 'active',
      ...writePosition(ev),
    },
  );
}

/** The operator moved the season end forward. */
export const onSeasonEndedEarly = (
  ev: IndexedEvent<ArenaEvents['season_ended_early']>,
  store: Store,
) =>
  patchSeason(store, BigInt(ev.data.season), {
    endMs: BigInt(ev.data.end_ms),
    ...writePosition(ev),
  });

export const onSeasonClosed = (ev: IndexedEvent<ArenaEvents['season_closed']>, store: Store) =>
  patchSeason(store, BigInt(ev.data.season), { phase: 'closed', ...writePosition(ev) });

export const onResultsPosted = (ev: IndexedEvent<ArenaEvents['results_posted']>, store: Store) =>
  patchSeason(store, BigInt(ev.data.season), {
    phase: 'results_posted',
    prizeRoot: hexOf(ev.data.prize_root),
    bonusRoot: hexOf(ev.data.bonus_root),
    prizeTotal: BigInt(ev.data.prize_total),
    bonusTotal: BigInt(ev.data.bonus_total),
    resultsPostedAt: ev.block.timestampMs,
    claimOpensMs: BigInt(ev.data.claim_opens_ms),
    ...writePosition(ev),
  });

/** The guardian rejected the posted results during the dispute window: back to closed, roots cleared. */
export const onResultsRejected = (
  ev: IndexedEvent<ArenaEvents['results_rejected']>,
  store: Store,
) =>
  patchSeason(store, BigInt(ev.data.season), {
    phase: 'closed',
    prizeRoot: null,
    bonusRoot: null,
    prizeTotal: null,
    bonusTotal: null,
    resultsPostedAt: null,
    claimOpensMs: null,
    ...writePosition(ev),
  });

export const onSeasonRolledOver = (
  ev: IndexedEvent<ArenaEvents['season_rolled_over']>,
  store: Store,
) =>
  patchSeason(store, BigInt(ev.data.from_season), {
    phase: 'rolled_over',
    rolledOverAmount: BigInt(ev.data.amount),
    ...writePosition(ev),
  });

/** Pot funding of a season: the running pot total, and the season on the harvest rows of the same transaction. */
export async function onPotFunded(ev: IndexedEvent<ArenaEvents['pot_funded']>, store: Store) {
  const season = BigInt(ev.data.season);
  await patchSeason(store, season, { pot: BigInt(ev.data.pot), ...writePosition(ev) });
  for (const pool of ['fighter', 'backer'] as const) {
    const id = `${txOf(ev)}-${pool}`;
    const harvest = await store.find('harvest', { id });
    if (harvest && harvest.season === null)
      await store.upsert('harvest', { id }, {}, () => ({ season, ...writePosition(ev) }));
  }
}

async function recordClaim(
  kind: 'prize' | 'bonus',
  ev: IndexedEvent<{ season: number; account_id: string; amount: string }>,
  store: Store,
) {
  await store.upsert(
    'claim',
    { id: eventId(ev) },
    {
      season: BigInt(ev.data.season),
      account: ev.data.account_id,
      kind,
      amount: BigInt(ev.data.amount),
      timestamp: ev.block.timestampMs,
      txHash: txOf(ev),
      ...writePosition(ev),
    },
  );
}

export const onPrizeClaimed = (ev: IndexedEvent<ArenaEvents['prize_claimed']>, store: Store) =>
  recordClaim('prize', ev, store);

export const onBonusClaimed = (ev: IndexedEvent<ArenaEvents['bonus_claimed']>, store: Store) =>
  recordClaim('bonus', ev, store);
