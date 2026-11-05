/**
 * A duel event of the arena (NEP-297 `hairto` standard) with where it happened. The live event source arrives
 * with the indexer; until then only indexed rows produce steps.
 */
export type ChainDuelEvent = {
  /** Base58 hash of the transaction the receipt belongs to. */
  txHash: string;
  block: bigint;
  /** Index of the event among the receipt's logs. */
  logIndex: number;
  id: bigint;
} & (
  | { kind: 'created' }
  | { kind: 'positionOpened'; player: string; tick: number }
  | {
      kind: 'positionClosed';
      player: string;
      dir: number;
      pnlPpm: number;
      selfDelta: number;
      opponentDelta: number;
    }
  | {
      kind: 'positionPenalized';
      player: string;
      pnlPpm: number;
      selfDelta: number;
      opponentDelta: number;
    }
  | { kind: 'finished' }
  | { kind: 'forfeited' }
  | { kind: 'voided' }
  | { kind: 'seedRevealed' }
);

/** One on-chain step of a duel as the UI shows it. Both the live watcher and the indexer produce it. */
export interface OnchainStep {
  kind:
    | 'created'
    | 'opened'
    | 'closed'
    | 'penalized'
    | 'finished'
    | 'forfeited'
    | 'voided'
    | 'seed_revealed';
  side: 'fighter' | 'bot' | null;
  txHash: string;
  at: string;
  dir: 'LONG' | 'SHORT' | null;
  pnlPpm: number | null;
  selfDelta: number | null;
  opponentDelta: number | null;
}

/** A step with its position in the chain, to order and de-duplicate the two sources. */
export type PlacedStep = OnchainStep & { block: number; logIndex: number };

export const onchainKey = (duelId: string) => `duel:onchain:${duelId}`;
export const ONCHAIN_TTL_SEC = 24 * 60 * 60;

const DIR = { 1: 'LONG', 2: 'SHORT' } as const;

/** The step an arena event stands for; `bot` is the duel's bot account. */
export function stepOf(ev: ChainDuelEvent, bot: string): PlacedStep {
  const base = {
    txHash: ev.txHash,
    at: new Date().toISOString(),
    block: Number(ev.block),
    logIndex: ev.logIndex,
    dir: null,
    pnlPpm: null,
    selfDelta: null,
    opponentDelta: null,
  };
  const sideOf = (player: string) => (player === bot ? 'bot' : 'fighter');
  switch (ev.kind) {
    case 'created':
      return { ...base, kind: 'created', side: null };
    case 'positionOpened':
      return { ...base, kind: 'opened', side: sideOf(ev.player) };
    case 'positionClosed':
      return {
        ...base,
        kind: 'closed',
        side: sideOf(ev.player),
        dir: DIR[ev.dir as 1 | 2] ?? null,
        pnlPpm: ev.pnlPpm,
        selfDelta: ev.selfDelta,
        opponentDelta: ev.opponentDelta,
      };
    case 'positionPenalized':
      return {
        ...base,
        kind: 'penalized',
        side: sideOf(ev.player),
        pnlPpm: ev.pnlPpm,
        selfDelta: ev.selfDelta,
        opponentDelta: ev.opponentDelta,
      };
    case 'finished':
      return { ...base, kind: 'finished', side: null };
    case 'forfeited':
      return { ...base, kind: 'forfeited', side: null };
    case 'voided':
      return { ...base, kind: 'voided', side: null };
    case 'seedRevealed':
      return { ...base, kind: 'seed_revealed', side: null };
  }
}
