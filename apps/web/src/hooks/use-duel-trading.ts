'use client';

import { DUEL, Dir, commitHash, fromBase64, toBase64 } from '@hairto-arena/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { loadPosition, savePosition, type StoredPosition } from '@/lib/duel-storage';
import { useNearWallet } from '@/lib/near/context';
import { txHashOf } from '@/lib/near/outcome';
import { arenaCall } from '@/lib/near/quick-play-key';
import { reasonOf } from '@/lib/trade-errors';
import type { DuelPhase, LiveDuelState, LiveTick } from './use-live-duel';

/**
 * Longest the panel waits for one transaction. A send that hangs (a busy RPC node) would keep the buttons locked;
 * after this the fate is unknown (`NOT CONFIRMED YET`), the position stays and the player can tap again. A close of
 * a position that never opened is refused by the contract with `no open position`, which clears it.
 */
const TX_TIMEOUT_MS = 9_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('transaction timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Margin over the contract's minimum hold, because block time and local time differ slightly. */
const HOLD_MARGIN_SEC = 0.5;
/**
 * A close tapped while the open is still being sent waits for it, then at least this long after the open was
 * confirmed: the contract measures the hold between the two block times and the close needs about two seconds to land.
 */
const OPEN_SETTLE_MS = 1_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  live: {
    state: LiveDuelState;
    phase: DuelPhase;
    now: number;
    endTs: number | null;
    /** The latest price tick: a trade tapped now is priced at it on-chain. */
    tick: LiveTick | null;
  },
  /** Called when the player taps close (not for the automatic reveal), so the arena can show the hit at once. */
  onClosing?: () => void,
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
  // Opening and closing are tracked apart: a close can be tapped (and queued) while the open is still in flight.
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);
  const pending = opening || closing;
  const [error, setError] = useState<string | null>(null);
  const revealing = useRef(false);
  const closingRef = useRef(false);
  const openFlow = useRef<Promise<void> | null>(null);
  const openLandedAt = useRef(0);
  const positionRef = useRef(position);
  const onClosingRef = useRef(onClosing);
  const tickRef = useRef(live.tick);
  useEffect(() => {
    positionRef.current = position;
    onClosingRef.current = onClosing;
    tickRef.current = live.tick;
  });

  const fighter = live.state.fighter;
  const fighterOpens = live.state.positions.filter((p) => !p.isBot).length;
  const tradesLeft = Math.max(0, DUEL.maxTradesPerDuel - fighterOpens);
  // The hold is counted between the price of the open and the price of the close, both ticks, as the arena counts it.
  // A position opened without a tick (none known yet) falls back to the local clock with a margin.
  const holdLeft = position
    ? position.tickPublishMs !== undefined && live.tick
      ? Math.max(0, DUEL.minHoldMs / 1000 - (live.tick.publishMs - position.tickPublishMs) / 1000)
      : Math.max(0, DUEL.minHoldMs / 1000 + HOLD_MARGIN_SEC - (live.now * 1000 - position.openedAt) / 1000)
    : 0;
  const inRound = live.phase === 'live';
  const inGrace =
    live.phase === 'reveal' && live.endTs !== null && live.now < live.endTs + DUEL.revealGraceMs / 1000;

  const send = useCallback(
    async (method: 'open_position' | 'close_position', args: object) => {
      if (!duelId || !accountId || !wallet) throw new Error('No duel');
      const outcome = await withTimeout(arenaCall(config, accountId, wallet, method, args), TX_TIMEOUT_MS);
      const hash = txHashOf(outcome);
      if (hash)
        void api(`/duels/${duelId}/tx`, { method: 'POST', body: JSON.stringify({ txHash: hash }) }).catch(
          () => undefined,
        );
    },
    [accountId, config, duelId, wallet],
  );

  const close = useCallback(
    async (tappedAt?: LiveTick | null) => {
      if (!duelId || !accountId || closingRef.current) return;
      closingRef.current = true;
      setClosing(true);
      setError(null);
      try {
        // Tapped while the open is still being sent: wait for it. A close priced at a tick needs no further wait
        // (the hold is between ticks); one without a tick waits a moment so the contract's block-time hold passes.
        if (openFlow.current) {
          await openFlow.current;
          const wait = (tappedAt ? 0 : OPEN_SETTLE_MS) - (Date.now() - openLandedAt.current);
          if (wait > 0) await sleep(wait);
        }
        const current = positionRef.current;
        // The open never landed and was cleared: nothing to close.
        if (!current) return;
        // The tick seen at the tap prices the close. If it turned out too old, or the hold is not met between the
        // ticks, the close is sent again at the newest tick, then at the arena's latest.
        let tick = tappedAt ?? undefined;
        for (let attempt = 0; ; attempt++) {
          try {
            await send('close_position', {
              duel_id: Number(duelId),
              dir: dirName(current.dir),
              salt: current.salt,
              ...(tick ? { tick_index: tick.index } : {}),
            });
            savePosition(accountId, duelId, null);
            setPosition(null);
            positionRef.current = null;
            return;
          } catch (err) {
            const reason = reasonOf(err);
            if (attempt < 2 && (reason === 'HOLD 3s FIRST' || reason === 'PRICE TOO OLD')) {
              await sleep(1_000);
              tick = attempt === 0 ? (tickRef.current ?? undefined) : undefined;
              continue;
            }
            throw err;
          }
        }
      } catch (err) {
        // The open never landed: nothing to reveal, give the buttons back.
        if ((err as Error)?.message?.includes('no open position')) {
          savePosition(accountId, duelId, null);
          setPosition(null);
          positionRef.current = null;
        }
        setError(reasonOf(err));
      } finally {
        closingRef.current = false;
        setClosing(false);
      }
    },
    [accountId, duelId, send, setPosition],
  );

  const open = useCallback(
    async (side: TradeSide) => {
      if (!duelId || !accountId || !fighter) return;
      const salt = crypto.getRandomValues(new Uint8Array(32));
      const tick = tickRef.current;
      const next: StoredPosition = {
        dir: toDir(side),
        salt: toBase64(salt),
        openedAt: Date.now(),
        ...(tick ? { tickIndex: tick.index, tickPrice: tick.price, tickPublishMs: tick.publishMs } : {}),
      };
      // Stored before sending, so a reload mid-transaction can still reveal.
      savePosition(accountId, duelId, next);
      setPosition(next);
      setOpening(true);
      setError(null);
      const run = (async () => {
        try {
          const commit = commitHash(next.dir, fromBase64(next.salt), BigInt(duelId), fighter);
          await send('open_position', {
            duel_id: Number(duelId),
            commit: toBase64(commit),
            ...(tick ? { tick_index: tick.index } : {}),
          });
          openLandedAt.current = Date.now();
        } catch (err) {
          // Keep the salt when the open may have landed: losing it means an unrevealed penalty.
          // A later close that finds no position clears it.
          if (reasonOf(err) !== 'NOT CONFIRMED YET') {
            savePosition(accountId, duelId, null);
            setPosition(null);
            positionRef.current = null;
          }
          setError(reasonOf(err));
        } finally {
          openFlow.current = null;
          setOpening(false);
        }
      })();
      openFlow.current = run;
      await run;
    },
    [accountId, duelId, fighter, send, setPosition],
  );

  /** LONG/SHORT: open with no position, close by tapping the same side again (also while the open is in flight). */
  const chooseSide = useCallback(
    (side: TradeSide) => {
      if (closing) return;
      if (position) {
        if (toDir(side) === position.dir && (inRound ? holdLeft === 0 : inGrace)) {
          onClosingRef.current?.();
          void close(tickRef.current);
        }
        return;
      }
      if (opening) return;
      if (inRound && tradesLeft > 0) void open(side);
    },
    [close, closing, holdLeft, inGrace, inRound, open, opening, position, tradesLeft],
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
    /** The price the open was made at (a tick), or null when it was opened without one. */
    entryPrice: position?.tickPrice ?? null,
    pending,
    error,
    tradesLeft,
    holdLeft,
    canOpen: inRound && !position && tradesLeft > 0 && !pending,
    canClose: !!position && !closing && (inRound ? holdLeft === 0 : inGrace),
    chooseSide,
  };
}
