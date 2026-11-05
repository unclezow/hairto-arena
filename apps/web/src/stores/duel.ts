import { create } from 'zustand';
import { DUEL, Dir, type OracleHealth, type TickEvent } from '@hairto-arena/shared';

type Phase = 'idle' | 'countdown' | 'live' | 'settling' | 'finished' | 'voided';

interface DuelState {
  duelId: string | null;
  phase: Phase;
  hpFighter: number;
  hpBot: number;
  ticks: TickEvent[];
  oracle: OracleHealth;
  /** The fighter's own open position. The salt never leaves the browser until reveal. */
  position: { dir: Dir.Long | Dir.Short; salt: string; commit: string } | null;

  reset: (duelId: string) => void;
  setPhase: (phase: Phase) => void;
  pushTick: (tick: TickEvent) => void;
  setHp: (hpFighter: number, hpBot: number) => void;
  setOracle: (status: OracleHealth) => void;
  setPosition: (position: DuelState['position']) => void;
}

/** Local state for one live duel (NEAR PRD section 13: Zustand for duel state). */
export const useDuelStore = create<DuelState>((set) => ({
  duelId: null,
  phase: 'idle',
  hpFighter: DUEL.startingHp,
  hpBot: DUEL.startingHp,
  ticks: [],
  oracle: 'ok',
  position: null,

  reset: (duelId) =>
    set({
      duelId,
      phase: 'idle',
      hpFighter: DUEL.startingHp,
      hpBot: DUEL.startingHp,
      ticks: [],
      oracle: 'ok',
      position: null,
    }),
  setPhase: (phase) => set({ phase }),
  pushTick: (tick) => set((s) => ({ ticks: [...s.ticks.slice(-299), tick] })),
  setHp: (hpFighter, hpBot) => set({ hpFighter, hpBot }),
  setOracle: (oracle) => set({ oracle }),
  setPosition: (position) => set({ position }),
}));
