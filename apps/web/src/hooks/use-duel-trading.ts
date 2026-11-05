'use client';

import { DUEL, Dir, commitHash, fromBase64, toBase64 } from '@hairto-arena/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { loadPosition, savePosition, type StoredPosition } from '@/lib/duel-storage';
import { useNearWallet } from '@/lib/near/context';
import { txHashOf } from '@/lib/near/outcome';
import { arenaCall } from '@/lib/near/quick-play-key';
import { reasonOf } from '@/lib/trade-errors';
import type { DuelPhase, LiveDuelState } from './use-live-duel';

/** Margin over the contract's minimum hold, because block time and local time differ slightly. */
const HOLD_MARGIN_SEC = 0.5;

export type TradeSide = 'long' | 'short';
const toDir = (side: TradeSide) => (side === 'long' ? Dir.Long : Dir.Short);
const dirName = (dir: Dir.Long | Dir.Short) => (dir === Dir.Long ? 'Long' : 'Short');

/**
 * Hidden positions on-chain: open with a sha256 commit, reveal on close. The salt is stored in `localStorage`
 * before sending, so a reload can still reveal. Moves go through the quick-play key (no wallet prompt) and every
 * executed transaction hash is relayed to the API for realtime HP. Guards mirror the contract to avoid paying for
 * failures; the contract stays the authority.
 */
export function useDuelTrading(
  duelId: string | null,
  live: { state: LiveDuelState; phase: DuelPhase; now: number; endTs: number | null },
) {
  const { config, accountId, wallet } = useNearWallet();
  const [stored, setStored] = useState(() => ({
    key: `${accountId}:${duelId}`,
    position: duelId && accountId ? loadPosition(accountId, duelId) : null,
  }));
  // Another duel or account in the same mounted arena: read its own stored position.
  const key = `${accountId}:${duelId}`;
  if (stored.key !== key)
    setStored({ key, position: duelId && accountId ? loadPosition(accountId, duelId) : null });
  const setPosition = useCallback(
    (position: StoredPosition | null) => setStored((s) => ({ ...s, position })),
    [],
  );
  const position = live.phase === 'over' ? null : stored.position;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revealing = useRef(false);

  const fighter = live.state.fighter;
  const fighterOpens = live.state.positions.filter((p) => !p.isBot).length;
  const tradesLeft = Math.max(0, DUEL.maxTradesPerDuel - fighterOpens);
  const holdLeft = position
    ? Math.max(0, DUEL.minHoldMs / 1000 + HOLD_MARGIN_SEC - (live.now * 1000 - position.openedAt) / 1000)
    : 0;
  const inRound = live.phase === 'live';
  const inGrace =
    live.phase === 'reveal' && live.endTs !== null && live.now < live.endTs + DUEL.revealGraceMs / 1000;

  const send = useCallback(
    async (method: 'open_position' | 'close_position', args: object) => {
      if (!duelId || !accountId || !wallet) throw new Error('No duel');
      const outcome = await arenaCall(config, accountId, wallet, method, args);
      const hash = txHashOf(outcome);
      if (hash)
        void api(`/duels/${duelId}/tx`, { method: 'POST', body: JSON.stringify({ txHash: hash }) }).catch(
          () => undefined,
        );
    },
    [accountId, config, duelId, wallet],
  );

  const close = useCallback(async () => {
    if (!duelId || !accountId || !position) return;
    setPending(true);
    setError(null);
    try {
      await send('close_position', { duel_id: Number(duelId), dir: dirName(position.dir), salt: position.salt });
      savePosition(accountId, duelId, null);
      setPosition(null);
    } catch (err) {
      // The open never landed: nothing to reveal, give the buttons back.
      if ((err as Error)?.message?.includes('no open position')) {
        savePosition(accountId, duelId, null);
        setPosition(null);
      }
      setError(reasonOf(err));
    } finally {
      setPending(false);
    }
  }, [accountId, duelId, position, send, setPosition]);

  const open = useCallback(
    async (side: TradeSide) => {
      if (!duelId || !accountId || !fighter) return;
      const salt = crypto.getRandomValues(new Uint8Array(32));
      const next: StoredPosition = { dir: toDir(side), salt: toBase64(salt), openedAt: Date.now() };
      // Stored before sending, so a reload mid-transaction can still reveal.
      savePosition(accountId, duelId, next);
      setPosition(next);
      setPending(true);
      setError(null);
      try {
        const commit = commitHash(next.dir, fromBase64(next.salt), BigInt(duelId), fighter);
        await send('open_position', { duel_id: Number(duelId), commit: toBase64(commit) });
      } catch (err) {
        // Keep the salt when the open may have landed: losing it means an unrevealed penalty.
        // A later close that finds no position clears it.
        if (reasonOf(err) !== 'NOT CONFIRMED YET') {
          savePosition(accountId, duelId, null);
          setPosition(null);
        }
        setError(reasonOf(err));
      } finally {
        setPending(false);
      }
    },
    [accountId, duelId, fighter, send, setPosition],
  );

  /** LONG/SHORT: open with no position, close by tapping the same side again. */
  const chooseSide = useCallback(
    (side: TradeSide) => {
      if (pending) return;
      if (position) {
        if (toDir(side) === position.dir && (inRound ? holdLeft === 0 : inGrace)) void close();
        return;
      }
      if (inRound && tradesLeft > 0) void open(side);
    },
    [close, holdLeft, inGrace, inRound, open, pending, position, tradesLeft],
  );

  // A position still open when the round ends is revealed inside the grace window, retried every ~2 s.
  const retryTick = Math.floor(live.now / 2);
  useEffect(() => {
    if (!position || !inGrace || pending || revealing.current) return;
    revealing.current = true;
    void close().finally(() => {
      revealing.current = false;
    });
  }, [close, inGrace, pending, position, retryTick]);

  useEffect(() => {
    if (duelId && accountId && live.phase === 'over') savePosition(accountId, duelId, null);
  }, [accountId, duelId, live.phase]);

  /** What the panel should say about the trade right now, or null for its normal hint. */
  const status = pending
    ? position && !inRound
      ? 'ROUND OVER · REVEALING…'
      : position
        ? 'SENDING…'
        : 'OPENING…'
    : error
      ? `${error} · TAP AGAIN`
      : position && inGrace
        ? 'ROUND OVER · REVEALING…'
        : null;

  return {
    status,
    side: position ? (position.dir === Dir.Long ? ('long' as const) : ('short' as const)) : null,
    openedAt: position?.openedAt ?? null,
    pending,
    error,
    tradesLeft,
    holdLeft,
    canOpen: inRound && !position && tradesLeft > 0 && !pending,
    canClose: !!position && !pending && (inRound ? holdLeft === 0 : inGrace),
    chooseSide,
  };
}
