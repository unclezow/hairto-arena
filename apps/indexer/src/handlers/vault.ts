import type { ArenaEvents, PoolName, VaultEvents } from '@hairto-arena/shared';
import { eventId, txOf, writePosition, type IndexedEvent, type Store } from './store.js';

type VaultEventKind = 'deposit' | 'withdraw' | 'claim_yield';

const poolOf = (pool: PoolName) => (pool === 'Fighter' ? 'fighter' : 'backer');

async function recordVaultEvent(
  kind: VaultEventKind,
  pool: 'fighter' | 'backer',
  ev: IndexedEvent<{ account_id: string; amount: string }>,
  store: Store,
) {
  await store.upsert(
    'vaultEvent',
    { id: eventId(ev) },
    {
      pool,
      account: ev.data.account_id,
      kind,
      amount: BigInt(ev.data.amount),
      timestamp: ev.block.timestampMs,
      txHash: txOf(ev),
      ...writePosition(ev),
    },
  );
}

export const onDeposited = (ev: IndexedEvent<VaultEvents['vault_deposited']>, store: Store) =>
  recordVaultEvent('deposit', poolOf(ev.data.pool), ev, store);

export const onWithdrawn = (ev: IndexedEvent<VaultEvents['vault_withdrawn']>, store: Store) =>
  recordVaultEvent('withdraw', poolOf(ev.data.pool), ev, store);

/** Only Backers earn a depositor share, so a yield claim is always from the Backer pool. */
export const onYieldClaimed = (
  ev: IndexedEvent<VaultEvents['vault_yield_claimed']>,
  store: Store,
) => recordVaultEvent('claim_yield', 'backer', ev, store);

/**
 * One `vault_harvested` covers both pools: a harvest row per pool that accrued anything, keyed by the transaction
 * so the arena's `pot_funded` later in the same transaction can attach the funded season.
 */
export async function onHarvested(ev: IndexedEvent<VaultEvents['vault_harvested']>, store: Store) {
  for (const pool of ['fighter', 'backer'] as const) {
    const accrued = ev.data[pool];
    const fee = BigInt(accrued.fee);
    const toPot = BigInt(accrued.pot);
    const toOwners = BigInt(accrued.owners);
    if (fee + toPot + toOwners === 0n) continue;
    await store.upsert(
      'harvest',
      { id: `${txOf(ev)}-${pool}` },
      {
        pool,
        season: null,
        grossYield: fee + toPot + toOwners,
        fee,
        toPot,
        toOwners,
        timestamp: ev.block.timestampMs,
        txHash: txOf(ev),
        ...writePosition(ev),
      },
    );
  }
}

export async function onPicked(ev: IndexedEvent<ArenaEvents['picked']>, store: Store) {
  const { data } = ev;
  const row = { fighter: data.fighter, timestamp: ev.block.timestampMs, ...writePosition(ev) };
  await store.upsert('pick', { season: BigInt(data.season), backer: data.backer }, row, () => row);
}
