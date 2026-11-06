'use client';

import {
  DUEL,
  WS_EVENTS,
  type DuelPositionEvent,
  type DuelSnapshotEvent,
  type QuoteEvent,
} from '@hairto-arena/shared';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { clockOffsetMs, toLocalSec } from '@/lib/chain-clock';
import { viewClient } from '@/lib/near/client';
import { useNearWallet } from '@/lib/near/context';
import { getSocket } from '@/lib/socket';
import { useWalletSession } from './use-wallet-session';

type Status = DuelSnapshotEvent['status'];
type PositionResult = Omit<DuelPositionEvent, 'duelId' | 'seq' | 'provisional'>;

/** A display quote for the chart, with the publish time in seconds. */
export interface ChartQuote {
  assetId: number;
  price: string;
  publishTime: number;
}

export interface LiveDuelState {
  status: Status | null;
  fighter: string | null;
  assetId: number | null;
  /** Round start in seconds, from the arena duel `start_ms`. */
  startTs: number | null;
  /** Set when the chain recorded a K.O. (`ko_ms`), in seconds. */
  koTs: number | null;
  hp: { fighter: number; bot: number };
  positions: PositionResult[];
  winner: string | null;
  ko: boolean;
  pointsAwarded: number | null;
  botSeed: string | null;
}

export type DuelPhase = 'loading' | 'countdown' | 'live' | 'reveal' | 'over';

/** The arena `get_duel` view, as far as the live screen reads it. */
interface DuelView {
  fighter: string;
  asset_id: number;
  start_ms: number;
  effective_end_ms: number;
  ko_ms: number | null;
  hp_fighter: number;
  hp_bot: number;
  status: 'Active' | 'Finished' | 'Forfeited' | 'Voided';
  winner: string | null;
  ko: boolean;
}

const MAX_QUOTES = 300;
/** View poll while the duel runs; socket events arrive first, the chain corrects them. */
const VIEW_POLL_MS = 1_000;

const STATUS: Record<DuelView['status'], Status> = {
  Active: 'active',
  Finished: 'finished',
  Forfeited: 'forfeited',
  Voided: 'voided',
};

function withoutBase(e: DuelPositionEvent): PositionResult {
  const drop = new Set(['duelId', 'seq', 'provisional']);
  return Object.fromEntries(Object.entries(e).filter(([k]) => !drop.has(k))) as PositionResult;
}

const toQuote = (q: QuoteEvent): ChartQuote => ({ assetId: q.assetId, price: q.price, publishTime: q.publishMs / 1000 });

const initial: LiveDuelState = {
  status: null,
  fighter: null,
  assetId: null,
  startTs: null,
  koTs: null,
  hp: { fighter: DUEL.startingHp, bot: DUEL.startingHp },
  positions: [],
  winner: null,
  ko: false,
  pointsAwarded: null,
  botSeed: null,
};

const isTerminal = (status: Status | null) => status === 'finished' || status === 'forfeited' || status === 'voided';

/**
 * One live duel: realtime events from the gateway (snapshot first, then events in `seq` order; a gap or a reconnect
 * joins again), plus a one-second `get_duel` view poll whose values win over the socket. K.O. comes from the
 * chain (`ko_ms`). After settlement the arena deletes the duel, so a `null` view after a terminal state means
 * finalized and the result is read from the API. Times are exposed in seconds for the arena screen.
 */
export function useLiveDuel(
  duelId: string | null,
  onClose?: (p: PositionResult) => void,
  /** The game has stopped for the player (K.O.): the chart stops taking new quotes. */
  halted = false,
) {
  const { token } = useWalletSession();
  const { config } = useNearWallet();
  const [state, setState] = useState<LiveDuelState>(initial);
  const [quotes, setQuotes] = useState<ChartQuote[]>([]);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const seq = useRef(-1);
  // Chain minus local clock, so the countdown and the round end line up with the arena's block times.
  const [offsetMs, setOffsetMs] = useState(0);
  useEffect(() => {
    if (!duelId) return;
    let cancelled = false;
    const sentAt = Date.now();
    void viewClient(config)
      .rpc.getStatus()
      .then((status) => {
        const half = (Date.now() - sentAt) / 2;
        if (!cancelled) setOffsetMs(clockOffsetMs(status.sync_info.latest_block_time, sentAt + half));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [config, duelId]);
  const onCloseRef = useRef(onClose);
  const haltedRef = useRef(halted);
  useEffect(() => {
    onCloseRef.current = onClose;
    haltedRef.current = halted;
  });

  useEffect(() => {
    if (!duelId) return;
    const timer = setInterval(() => setNow(Date.now() / 1000), 250);
    return () => clearInterval(timer);
  }, [duelId]);

  // Realtime events from the gateway.
  useEffect(() => {
    if (!duelId || !token) return;
    const socket = getSocket();
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let joinTries = 0;
    // The duel can reach the API's database a moment after the browser opens the arena. A refused join is retried
    // instead of watching nothing, because only a joined room receives the attack events.
    const join = () => {
      clearTimeout(retry);
      socket.emit(
        WS_EVENTS.joinDuel,
        duelId,
        (ack?: { ok: boolean; error?: { code?: string } }) => {
          if (stopped || !ack) return;
          if (ack.ok) {
            joinTries = 0;
            return;
          }
          if (ack.error?.code === 'NOT_FOUND' && ++joinTries <= 30) retry = setTimeout(join, 500);
        },
      );
    };
    const mine = (data: { duelId?: string }) => data?.duelId === duelId;
    const next = (data: { seq: number }) => {
      if (data.seq <= seq.current) return false;
      if (data.seq !== seq.current + 1) {
        join();
        return false;
      }
      seq.current = data.seq;
      return true;
    };

    const onSnapshot = (s: DuelSnapshotEvent) => {
      if (!mine(s) || s.seq < seq.current) return;
      seq.current = s.seq;
      setState((prev) => ({
        ...prev,
        status: s.status,
        fighter: s.fighter,
        assetId: s.assetId,
        startTs: s.startMs === null ? prev.startTs : s.startMs / 1000,
        hp: s.hp,
        positions: s.positions,
        winner: s.winner,
        ko: s.ko,
      }));
    };
    const onStarted = (e: { duelId: string; seq: number; startMs: number; assetId: number }) => {
      if (!mine(e) || !next(e)) return;
      setState((prev) => ({ ...prev, status: 'active', startTs: e.startMs / 1000, assetId: e.assetId }));
    };
    const onPosition = (e: DuelPositionEvent) => {
      if (!mine(e) || !next(e)) return;
      const position = withoutBase(e);
      // One entry per position: a close replaces that player's open entry.
      setState((prev) => {
        const positions = [...prev.positions];
        const openIndex = positions.findLastIndex((p) => p.player === position.player && p.state === 'opened');
        if (position.state === 'closed' && openIndex !== -1) positions[openIndex] = position;
        else positions.push(position);
        return { ...prev, positions };
      });
      if (position.state === 'closed') onCloseRef.current?.(position);
    };
    const onHp = (e: { duelId: string; seq: number; hpFighter: number; hpBot: number }) => {
      if (!mine(e) || !next(e)) return;
      setState((prev) => ({ ...prev, hp: { fighter: e.hpFighter, bot: e.hpBot } }));
    };
    const onResult = (e: {
      duelId: string;
      seq: number;
      winner: string | null;
      ko: boolean;
      pointsAwarded?: number;
      botSeed?: string;
    }) => {
      if (!mine(e) || !next(e)) return;
      setState((prev) => ({
        ...prev,
        status: prev.status === 'forfeited' ? prev.status : 'finished',
        winner: e.winner,
        ko: e.ko,
        pointsAwarded: e.pointsAwarded ?? prev.pointsAwarded,
        botSeed: e.botSeed ?? prev.botSeed,
      }));
    };
    const onVoided = (e: { duelId: string; seq: number }) => {
      if (!mine(e) || !next(e)) return;
      setState((prev) => ({ ...prev, status: 'voided' }));
    };
    const onSeed = (e: { duelId: string; seq: number; seed: string }) => {
      if (!mine(e) || !next(e)) return;
      setState((prev) => ({ ...prev, botSeed: e.seed }));
    };

    socket.on(WS_EVENTS.duelSnapshot, onSnapshot);
    socket.on(WS_EVENTS.duelStarted, onStarted);
    socket.on(WS_EVENTS.duelPosition, onPosition);
    socket.on(WS_EVENTS.hpUpdate, onHp);
    socket.on(WS_EVENTS.duelResult, onResult);
    socket.on(WS_EVENTS.duelVoided, onVoided);
    socket.on(WS_EVENTS.duelSeed, onSeed);
    socket.on('connect', join);
    if (socket.connected) join();
    else socket.connect();

    return () => {
      stopped = true;
      clearTimeout(retry);
      socket.emit(WS_EVENTS.leaveDuel, duelId);
      socket.off(WS_EVENTS.duelSnapshot, onSnapshot);
      socket.off(WS_EVENTS.duelStarted, onStarted);
      socket.off(WS_EVENTS.duelPosition, onPosition);
      socket.off(WS_EVENTS.hpUpdate, onHp);
      socket.off(WS_EVENTS.duelResult, onResult);
      socket.off(WS_EVENTS.duelVoided, onVoided);
      socket.off(WS_EVENTS.duelSeed, onSeed);
      socket.off('connect', join);
    };
  }, [duelId, token]);

  // The chain is the authority: poll `get_duel` while the duel is not terminal.
  const terminal = isTerminal(state.status);
  useEffect(() => {
    if (!duelId || terminal) return;
    let cancelled = false;
    let seen = false;
    const near = viewClient(config);
    const poll = async () => {
      try {
        const view = await near.view<DuelView | null>(config.contracts.arena, 'get_duel', { duel_id: Number(duelId) });
        if (cancelled) return;
        if (view) {
          seen = true;
          setState((prev) => ({
            ...prev,
            status: STATUS[view.status],
            fighter: view.fighter,
            assetId: view.asset_id,
            startTs: view.start_ms / 1000,
            koTs: view.ko_ms === null ? null : view.ko_ms / 1000,
            hp: { fighter: view.hp_fighter, bot: view.hp_bot },
            winner: view.winner ?? prev.winner,
            ko: view.ko || view.ko_ms !== null,
          }));
        } else if (seen) {
          // Settled, seed revealed and pruned: the read model has the final result.
          const final = await api<{ status: string; winner: string | null; ko?: boolean }>(`/duels/${duelId}`);
          if (cancelled) return;
          const status = final.status.toLowerCase() as Status;
          setState((prev) => ({
            ...prev,
            status: isTerminal(status) ? status : 'finished',
            winner: final.winner,
            ko: final.ko ?? prev.ko,
          }));
        }
      } catch {
        // A failed poll is retried on the next tick; the socket keeps the screen moving meanwhile.
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), VIEW_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [config, duelId, terminal]);

  // Display quotes for the chart.
  const assetId = state.assetId;
  useEffect(() => {
    if (assetId === null) return;
    let cancelled = false;
    const socket = getSocket();
    void api<{ items: { price: string; publishMs: number }[] }>(`/prices/${assetId}/history?limit=120`)
      .then(({ items }) => {
        if (cancelled) return;
        setQuotes((current) => {
          const seen = new Set(current.map((q) => q.publishTime));
          const backfill = items
            .map((q) => ({ assetId, price: q.price, publishTime: q.publishMs / 1000 }))
            .filter((q) => !seen.has(q.publishTime));
          return [...backfill, ...current].slice(-MAX_QUOTES);
        });
      })
      .catch(() => undefined);

    const onQuote = (q: QuoteEvent) => {
      if (q.assetId !== assetId || haltedRef.current) return;
      setQuotes((current) => [...current.slice(-(MAX_QUOTES - 1)), toQuote(q)]);
    };
    const join = () => socket.emit(WS_EVENTS.joinPrice, assetId);
    socket.on(WS_EVENTS.quote, onQuote);
    socket.on('connect', join);
    if (socket.connected) join();
    else socket.connect();
    return () => {
      cancelled = true;
      socket.emit(WS_EVENTS.leavePrice, assetId);
      socket.off(WS_EVENTS.quote, onQuote);
      socket.off('connect', join);
    };
  }, [assetId]);

  // Chain times moved to the local clock.
  const startTs = state.startTs === null ? null : toLocalSec(state.startTs, offsetMs);
  const koTs = state.koTs === null ? null : toLocalSec(state.koTs, offsetMs);
  const roundEnd = startTs === null ? null : startTs + DUEL.roundDurationMs / 1000;
  // A K.O. ends the round early on-chain; the reveal window starts there.
  const endTs = roundEnd === null ? null : koTs !== null ? Math.min(koTs, roundEnd) : roundEnd;
  const roundOver = endTs !== null && now >= endTs;
  useEffect(() => {
    haltedRef.current = halted || roundOver;
  }, [halted, roundOver]);
  const phase: DuelPhase =
    state.status === null || startTs === null || endTs === null
      ? 'loading'
      : isTerminal(state.status)
        ? 'over'
        : now < startTs
          ? 'countdown'
          : now < endTs
            ? 'live'
            : 'reveal';

  return { state: { ...state, startTs, koTs }, quotes, now, phase, endTs };
}
