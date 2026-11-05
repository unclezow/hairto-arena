const STYLES = {
  simulation: 'border-sky-400/40 text-sky-300',
  bot: 'border-amber-400/40 text-amber-300',
  mock: 'border-fuchsia-400/40 text-fuchsia-300',
} as const;

const LABELS = { simulation: 'Simulasi', bot: 'Bot', mock: 'Mock' } as const;

/** Honesty labels required by NEAR PRD section 13: paper positions, bot opponents, mock vaults. */
export function Badge({ kind }: { kind: keyof typeof STYLES }) {
  return (
    <span
      className={`inline-flex rounded border px-1.5 py-0.5 font-mono text-xs uppercase ${STYLES[kind]}`}
    >
      {LABELS[kind]}
    </span>
  );
}
