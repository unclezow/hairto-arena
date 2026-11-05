'use client';

import { DUEL } from '@hairto-arena/shared';
import { Badge } from '@/components/badge';
import { useDuelStore } from '@/stores/duel';

/** Live duel UI: chart, HP bars, LONG/SHORT/CLOSE, 30s timer (NEAR PRD section 13). */
export function DuelScreen({ duelId }: { duelId: string }) {
  const { hpFighter, hpBot, oracle } = useDuelStore();

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Duel #{duelId}</h1>
        <Badge kind="simulation" />
        <Badge kind="bot" />
        <span className="ml-auto font-mono text-xs text-white/50">oracle: {oracle}</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 font-mono text-sm">
        <HpBar label="You" hp={hpFighter} />
        <HpBar label="Bot" hp={hpBot} />
      </div>

      {/* TODO(work package 6): lightweight-charts price line with own-position markers only. */}
      <div className="mt-4 flex aspect-[16/7] items-center justify-center rounded-lg border border-white/10 text-white/30">
        chart · {(DUEL.roundDurationMs / 1000)}s round
      </div>

      {/* Direction is spelled out, never color-only (NEAR PRD section 13accessibility). */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <button
          type="button"
          disabled
          className="rounded-lg bg-long/80 py-4 text-lg font-bold text-black"
        >
          ▲ LONG
        </button>
        <button
          type="button"
          disabled
          className="rounded-lg bg-short/80 py-4 text-lg font-bold text-black"
        >
          ▼ SHORT
        </button>
        <button
          type="button"
          disabled
          className="rounded-lg border border-white/20 py-4 text-lg font-bold"
        >
          CLOSE
        </button>
      </div>
    </main>
  );
}

function HpBar({ label, hp }: { label: string; hp: number }) {
  const pct = Math.max(0, Math.min(100, (hp / DUEL.startingHp) * 100));
  return (
    <div>
      <div className="flex justify-between">
        <span>{label}</span>
        <span>{hp} HP</span>
      </div>
      <div
        className="mt-1 h-3 rounded bg-white/10"
        role="progressbar"
        aria-label={`${label} HP`}
        aria-valuenow={hp}
        aria-valuemin={0}
        aria-valuemax={DUEL.startingHp}
      >
        <div className="h-full rounded bg-white" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
