import type { ArenaEvents } from '@hairto-arena/shared';
import { eventId, txOf, writePosition, type IndexedEvent, type Row, type Store } from './store.js';

const GLOBAL = { id: 'global' };
/** Directions as the read model stores them: 1 long, 2 short. */
const DIR = { Long: 1, Short: 2 } as const;

async function bumpStat(
  store: Store,
  field: 'totalDuels' | 'finishedDuels' | 'forfeitedDuels' | 'voidedDuels',
  ev: IndexedEvent<unknown>,
) {
  const base = { totalDuels: 0, finishedDuels: 0, forfeitedDuels: 0, voidedDuels: 0 };
  await store.upsert(
    'globalStat',
    GLOBAL,
    { ...base, [field]: 1, ...writePosition(ev) },
    (row) => ({ [field]: (row[field] as number) + 1, ...writePosition(ev) }),
  );
}

/** Keeps the transaction behind a duel event; the same event processed twice writes the same row. */
async function recordTx(
  store: Store,
  ev: IndexedEvent<{ duel_id: number }>,
  kind: string,
  player: string | null = null,
  result: Row = {},
) {
  await store.upsert(
    'duelTx',
    { id: eventId(ev) },
    {
      duelId: BigInt(ev.data.duel_id),
      kind,
      player,
      txHash: txOf(ev),
      ...result,
      timestamp: ev.block.timestampMs,
      ...writePosition(ev),
    },
  );
}

const TERMINAL = new Set(['finished', 'forfeited', 'voided']);

/** Returns false when there is nothing to update: no row (created before the start block) or already terminal. */
async function endDuel(store: Store, id: bigint, patch: Row) {
  const existing = await store.find('duel', { id });
  if (!existing || TERMINAL.has(existing.status as string)) return false;
  await store.upsert('duel', { id }, {}, () => patch);
  return true;
}

async function updateDuel(store: Store, id: bigint, patch: Row) {
  const existing = await store.find('duel', { id });
  if (!existing) return false;
  await store.upsert('duel', { id }, {}, () => patch);
  return true;
}

export async function onDuelCreated(ev: IndexedEvent<ArenaEvents['duel_created']>, store: Store) {
  await recordTx(store, ev, 'created');
  const { data } = ev;
  const id = BigInt(data.duel_id);
  // Processing the same event twice must not count the duel twice.
  if (await store.find('duel', { id })) return;
  await store.upsert(
    'duel',
    { id },
    {
      fighter: data.fighter,
      bot: data.bot,
      botLevel: data.bot_level,
      assetId: BigInt(data.asset_id),
      season: BigInt(data.season),
      nonce: BigInt(data.nonce),
      startMs: BigInt(data.start_ms),
      status: 'created',
      createdAt: ev.block.timestampMs,
      ...writePosition(ev),
    },
  );
  await bumpStat(store, 'totalDuels', ev);
}

export async function onPositionOpened(
  ev: IndexedEvent<ArenaEvents['position_opened']>,
  store: Store,
) {
  const { data } = ev;
  await recordTx(store, ev, 'opened', data.player);
  const duelId = BigInt(data.duel_id);
  const positionId = `${duelId}-${data.player}-${ev.receiptId}-${ev.position.logIndex}`;
  await store.upsert(
    'position',
    { id: positionId },
    {
      duelId,
      player: data.player,
      openTick: BigInt(data.open_tick),
      openedAt: ev.block.timestampMs,
      ...writePosition(ev),
    },
  );
  await store.upsert(
    'openPosition',
    { id: `${duelId}-${data.player}` },
    { positionId, ...writePosition(ev) },
    () => ({ positionId, ...writePosition(ev) }),
  );
}

export async function onPositionClosed(
  ev: IndexedEvent<ArenaEvents['position_closed']>,
  store: Store,
) {
  const { data } = ev;
  const result = {
    dir: DIR[data.dir],
    pnlPpm: data.net_pnl_ppm,
    selfDelta: data.self_delta,
    opponentDelta: data.opponent_delta,
  };
  await recordTx(store, ev, 'closed', data.player, result);
  await finishPosition(ev, store, {
    ...result,
    closeTick: BigInt(data.close_tick),
    penalized: false,
  });
  await updateDuel(store, BigInt(data.duel_id), {
    hpFighter: data.hp_fighter,
    hpBot: data.hp_bot,
    ...writePosition(ev),
  });
}

/** A position never revealed: the arena charged the penalty at settle and the direction stays unknown. */
export async function onPositionPenalized(
  ev: IndexedEvent<ArenaEvents['position_penalized']>,
  store: Store,
) {
  const { data } = ev;
  const result = {
    pnlPpm: data.net_pnl_ppm,
    selfDelta: data.self_delta,
    opponentDelta: data.opponent_delta,
  };
  await recordTx(store, ev, 'penalized', data.player, result);
  await finishPosition(ev, store, { ...result, penalized: true });
  await updateDuel(store, BigInt(data.duel_id), {
    hpFighter: data.hp_fighter,
    hpBot: data.hp_bot,
    ...writePosition(ev),
  });
}

async function finishPosition(
  ev: IndexedEvent<{ duel_id: number; player: string }>,
  store: Store,
  result: Row,
) {
  const duelId = BigInt(ev.data.duel_id);
  const player = ev.data.player;
  const pointer = await store.find('openPosition', { id: `${duelId}-${player}` });
  // No pointer means the open event predates the start block; keep the close as its own row.
  const positionId =
    (pointer?.positionId as string | undefined) ??
    `${duelId}-${player}-${ev.receiptId}-${ev.position.logIndex}`;
  const closed = { ...result, closedAt: ev.block.timestampMs, ...writePosition(ev) };
  await store.upsert('position', { id: positionId }, { duelId, player, ...closed }, () => closed);
  if (pointer) await store.delete('openPosition', { id: `${duelId}-${player}` });
}

export async function onDuelFinished(ev: IndexedEvent<ArenaEvents['duel_finished']>, store: Store) {
  const { data } = ev;
  await recordTx(store, ev, 'finished');
  const updated = await endDuel(store, BigInt(data.duel_id), {
    status: 'finished',
    // A draw has no winner.
    winner: data.winner,
    ko: data.ko,
    hpFighter: data.hp_fighter,
    hpBot: data.hp_bot,
    finishedAt: ev.block.timestampMs,
    ...writePosition(ev),
  });
  if (updated) await bumpStat(store, 'finishedDuels', ev);
}

/** The Fighter never opened a position: the bot wins by forfeit. */
export async function onDuelForfeited(
  ev: IndexedEvent<ArenaEvents['duel_forfeited']>,
  store: Store,
) {
  await recordTx(store, ev, 'forfeited');
  const id = BigInt(ev.data.duel_id);
  const existing = await store.find('duel', { id });
  if (!existing) return;
  const updated = await endDuel(store, id, {
    status: 'forfeited',
    winner: existing.bot,
    finishedAt: ev.block.timestampMs,
    ...writePosition(ev),
  });
  if (updated) await bumpStat(store, 'forfeitedDuels', ev);
}

export async function onDuelVoided(ev: IndexedEvent<ArenaEvents['duel_voided']>, store: Store) {
  await recordTx(store, ev, 'voided');
  const updated = await endDuel(store, BigInt(ev.data.duel_id), {
    status: 'voided',
    finishedAt: ev.block.timestampMs,
    ...writePosition(ev),
  });
  if (updated) await bumpStat(store, 'voidedDuels', ev);
}

/** The seed is base64 of 32 bytes, as the arena logs it. */
export async function onBotSeedRevealed(
  ev: IndexedEvent<ArenaEvents['bot_seed_revealed']>,
  store: Store,
) {
  await recordTx(store, ev, 'seed_revealed');
  await updateDuel(store, BigInt(ev.data.duel_id), {
    botSeed: ev.data.seed,
    ...writePosition(ev),
  });
}
