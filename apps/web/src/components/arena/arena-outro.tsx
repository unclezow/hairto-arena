import Link from 'next/link';
import type { ArenaOutcome } from './arena-outcome';
import './arena-outro.css';

const COPY = {
  win: { title: 'VICTORY', note: 'You out-traded the bot. Your moment to shine.' },
  loss: { title: 'DEFEAT', note: 'This round belongs to the bot. Your next battle awaits.' },
  draw: { title: 'DRAW', note: 'Evenly matched. A battle worth fighting again.' },
  void: { title: 'DUEL VOIDED', note: 'The price feed interrupted this duel. No score awarded.' },
} as const;

export function ArenaOutro({ outcome, duelId }: { outcome: ArenaOutcome; duelId: string }) {
  return (
    <section className="arena-outro" data-outcome={outcome} aria-label="Duel outcome">
      <div className="arena-outro-vignette" aria-hidden="true" />
      <div className="arena-outro-banner" role="status">
        <span>◆ DUEL COMPLETE ◆</span>
        <h2>{COPY[outcome].title}</h2>
        <p>{COPY[outcome].note}</p>
      </div>
      <Link className="arena-outro-continue" href={`/duel/${duelId}/result`}>
        VIEW RESULT <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
