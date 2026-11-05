import Link from 'next/link';
import { ArenaIcon } from './arena-icons';

/** A beveled stone plaque, built as layers so its depth responds to hover/press. */
export function ArenaBackButton() {
  return (
    <Link href="/play/lobby" className="arena-stone-back" aria-label="Back to lobby">
      <span className="arena-stone-shadow" aria-hidden="true" />
      <span className="arena-stone-base" aria-hidden="true" />
      <span className="arena-stone-top">
        <span className="arena-stone-rim" aria-hidden="true" />
        <span className="arena-stone-face" aria-hidden="true">
          <svg viewBox="0 0 180 52" preserveAspectRatio="none">
            <path d="m67 0 4 9-4 5 6 5m-2-10 8-2M159 52l-4-10 5-5-2-7M0 34l12-3 7 4" />
          </svg>
        </span>
        <span className="arena-stone-content">
          <span className="arena-stone-arrow">
            <ArenaIcon name="back" size={19} />
          </span>
          <span className="arena-stone-label">BACK TO LOBBY</span>
          <span className="arena-stone-rivet" aria-hidden="true" />
        </span>
      </span>
    </Link>
  );
}
