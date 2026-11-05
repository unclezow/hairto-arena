import type { ArenaEvents } from '@hairto-arena/shared';
import { writePosition, type IndexedEvent, type Store } from './store.js';

/**
 * One `result_recorded` per scored duel (logged when the bot seed is revealed in time): the season score is only
 * written here. Points are signed; the season total never goes below zero, like the arena's own `score_of`.
 * `duels` and `wins` count every scored result.
 */
export async function onResultRecorded(
  ev: IndexedEvent<ArenaEvents['result_recorded']>,
  store: Store,
) {
  const { data } = ev;
  const duelId = BigInt(data.duel_id);
  const duel = await store.find('duel', { id: duelId });
  // The duel row records that its result was applied, so replaying the event never counts it twice.
  if (duel && duel.outcome !== undefined && duel.outcome !== null) return;

  const points = BigInt(data.points);
  const win = data.outcome === 'Win' ? 1 : 0;
  const floor = (v: bigint) => (v < 0n ? 0n : v);

  await store.upsert(
    'fighterScore',
    { season: BigInt(data.season), fighter: data.fighter },
    {
      points: floor(points),
      duels: 1,
      wins: win,
      reachedAt: points > 0n ? ev.block.timestampMs : 0n,
      ...writePosition(ev),
    },
    (row) => ({
      points: floor((row.points as bigint) + points),
      duels: (row.duels as number) + 1,
      wins: (row.wins as number) + win,
      // The tie-breaker moves whenever the point total changes.
      reachedAt: points !== 0n ? ev.block.timestampMs : row.reachedAt,
      ...writePosition(ev),
    }),
  );

  if (duel) {
    await store.upsert('duel', { id: duelId }, {}, () => ({
      outcome: data.outcome,
      pointsAwarded: points,
      counted: true,
      ...writePosition(ev),
    }));
  }
}
