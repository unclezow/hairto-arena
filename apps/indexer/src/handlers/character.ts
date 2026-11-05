import type { CharacterEvents, Nep245Events } from '@hairto-arena/shared';
import { eventId, txOf, writePosition, type IndexedEvent, type Store } from './store.js';

export async function onCharacterListed(
  ev: IndexedEvent<CharacterEvents['character_listed']>,
  store: Store,
) {
  const id = BigInt(ev.data.token_id);
  const listed = {
    price: BigInt(ev.data.price),
    maxSupply: ev.data.max_supply,
    active: true,
    ...writePosition(ev),
  };
  await store.upsert('character', { id }, { ...listed, minted: 0 }, () => listed);
}

export async function onCharacterUpdated(
  ev: IndexedEvent<CharacterEvents['character_updated']>,
  store: Store,
) {
  const id = BigInt(ev.data.token_id);
  if (!(await store.find('character', { id }))) return;
  await store.upsert('character', { id }, {}, () => ({
    price: BigInt(ev.data.price),
    maxSupply: ev.data.max_supply,
    active: ev.data.active,
    ...writePosition(ev),
  }));
}

async function recordAcquisition(
  kind: 'purchase' | 'grant',
  account: string,
  tokenId: string,
  price: bigint,
  ev: IndexedEvent<unknown>,
  store: Store,
) {
  await store.upsert(
    'characterPurchase',
    { id: eventId(ev) },
    {
      account,
      characterId: BigInt(tokenId),
      kind,
      price,
      timestamp: ev.block.timestampMs,
      txHash: txOf(ev),
      ...writePosition(ev),
    },
  );
}

export const onCharacterPurchased = (
  ev: IndexedEvent<CharacterEvents['character_purchased']>,
  store: Store,
) =>
  recordAcquisition('purchase', ev.data.buyer, ev.data.token_id, BigInt(ev.data.price), ev, store);

export const onCharacterGranted = (
  ev: IndexedEvent<CharacterEvents['character_granted']>,
  store: Store,
) => recordAcquisition('grant', ev.data.to, ev.data.token_id, 0n, ev, store);

/**
 * Balances and minted counts move only through `nep245` mints and transfers, so purchases, grants and peer
 * transfers are all covered. Each log is applied once per (account, id): the balance row remembers the last log
 * that wrote it. `from` null is a mint.
 */
async function applyTransfer(
  ev: IndexedEvent<unknown>,
  from: string | null,
  to: string,
  id: bigint,
  value: bigint,
  store: Store,
) {
  const pos = writePosition(ev);
  const seen = (row: Record<string, unknown> | null) =>
    row !== null &&
    ((row.blockHeight as bigint) > pos.blockHeight ||
      (row.blockHeight === pos.blockHeight && (row.logIndex as number) >= pos.logIndex));

  if (from !== null) {
    const key = { account: from, characterId: id };
    const row = await store.find('characterBalance', key);
    if (!seen(row)) {
      await store.upsert('characterBalance', key, { amount: 0n, ...pos }, (r) => ({
        amount: (r.amount as bigint) - value,
        ...pos,
      }));
    }
  } else {
    const row = await store.find('character', { id });
    if (row && !seen(row)) {
      await store.upsert('character', { id }, {}, (r) => ({
        minted: (r.minted as number) + Number(value),
        ...pos,
      }));
    }
  }
  const key = { account: to, characterId: id };
  const row = await store.find('characterBalance', key);
  if (!seen(row)) {
    await store.upsert('characterBalance', key, { amount: value, ...pos }, (r) => ({
      amount: (r.amount as bigint) + value,
      ...pos,
    }));
  }
}

export async function onMtMint(ev: IndexedEvent<Nep245Events['mt_mint']>, store: Store) {
  for (const entry of ev.data) {
    for (let i = 0; i < entry.token_ids.length; i++) {
      await applyTransfer(
        ev,
        null,
        entry.owner_id,
        BigInt(entry.token_ids[i]!),
        BigInt(entry.amounts[i]!),
        store,
      );
    }
  }
}

export async function onMtTransfer(ev: IndexedEvent<Nep245Events['mt_transfer']>, store: Store) {
  for (const entry of ev.data) {
    for (let i = 0; i < entry.token_ids.length; i++) {
      await applyTransfer(
        ev,
        entry.old_owner_id,
        entry.new_owner_id,
        BigInt(entry.token_ids[i]!),
        BigInt(entry.amounts[i]!),
        store,
      );
    }
  }
}

export async function onCharacterEquipped(
  ev: IndexedEvent<CharacterEvents['character_equipped']>,
  store: Store,
) {
  const account = ev.data.account_id;
  const characterId = BigInt(ev.data.token_id);
  await store.upsert(
    'characterEquipEvent',
    { id: eventId(ev) },
    { account, characterId, timestamp: ev.block.timestampMs, ...writePosition(ev) },
  );
  await store.upsert(
    'characterEquipped',
    { account },
    { characterId, ...writePosition(ev) },
    () => ({ characterId, ...writePosition(ev) }),
  );
}
