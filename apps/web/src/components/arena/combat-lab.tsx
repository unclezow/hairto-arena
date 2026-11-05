'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ATTACKS, type AttackKind, type FighterSide } from './arena-combat';
import { AttackIcon } from './attack-icon';

export function CombatLab({
  ready,
  busy,
  reducedMotion,
  defeated,
  onAttack,
  onReset,
}: {
  ready: boolean;
  busy: boolean;
  reducedMotion: boolean;
  defeated: boolean;
  onAttack: (kind: AttackKind, attacker: FighterSide) => void;
  onReset: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<AttackKind>('basic');
  const [attacker, setAttacker] = useState<FighterSide>('left');
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const close = () => {
    dialog.current?.close();
    setOpen(false);
    trigger.current?.focus();
  };
  const launch = () => {
    if (!ready || busy || reducedMotion || defeated) return;
    close();
    onAttack(selected, attacker);
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!open || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const kind = ({ '1': 'basic', '2': 'medium', '3': 'ultimate' } as const)[
        event.key as '1' | '2' | '3'
      ];
      if (kind) {
        event.preventDefault();
        setSelected(kind);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        className={`combat-lab-trigger ${busy ? 'is-busy' : ''}`}
        type="button"
        aria-label="Open combat lab"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!ready || busy}
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        <AttackIcon kind="lab" size={27} />
        <span className="combat-trigger-indicator" />
        <span className="combat-trigger-tooltip">COMBAT LAB</span>
      </button>
      <dialog
        ref={dialog}
        className="combat-lab-dialog"
        aria-labelledby={titleId}
        onCancel={() => {
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="combat-lab-inner">
          <header className="combat-lab-header">
            <span className="combat-lab-emblem">
              <AttackIcon kind="lab" size={23} />
            </span>
            <div>
              <p>THE PROVING GROUNDS</p>
              <h2 id={titleId}>Combat lab</h2>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close combat lab"
              className="combat-close"
            >
              ×
            </button>
          </header>
          <p className="combat-lab-intro">Choose your fighter. Test your power.</p>
          <div className="combat-attacker-label">
            <span>ATTACKING FIGHTER</span>
            <span>LOCAL PREVIEW</span>
          </div>
          <div className="combat-attacker-picker" role="group" aria-label="Attacking fighter">
            <button
              type="button"
              aria-pressed={attacker === 'left'}
              onClick={() => setAttacker('left')}
            >
              <span>A</span>The Sentinel
            </button>
            <button
              type="button"
              aria-pressed={attacker === 'right'}
              onClick={() => setAttacker('right')}
            >
              <span>B</span>The Berserker
            </button>
          </div>
          <div className="combat-attack-list" role="group" aria-label="Choose attack">
            {(Object.keys(ATTACKS) as AttackKind[]).map((kind) => {
              const attack = ATTACKS[kind];
              return (
                <button
                  key={kind}
                  type="button"
                  className={`combat-attack-card combat-${kind}`}
                  aria-pressed={selected === kind}
                  onClick={() => setSelected(kind)}
                >
                  <span className="combat-attack-symbol">
                    <AttackIcon kind={kind} size={29} />
                  </span>
                  <span className="combat-attack-copy">
                    <span className="combat-attack-tier">
                      {attack.label}
                      <span>{attack.damage} DMG</span>
                    </span>
                    <strong>{attack.name}</strong>
                    <span className="combat-attack-tag">{attack.tag}</span>
                  </span>
                  <kbd>{attack.shortcut}</kbd>
                </button>
              );
            })}
          </div>
          <p className="combat-selected-description">{ATTACKS[selected].description}</p>
          <button
            type="button"
            className={`combat-cast-button combat-${selected}`}
            disabled={!ready || busy || reducedMotion || defeated}
            onClick={launch}
          >
            <AttackIcon kind={selected} size={21} />
            <span>Unleash {ATTACKS[selected].label}</span>
            <span>↗</span>
          </button>
          <div className="combat-lab-bottom">
            <span>
              {reducedMotion
                ? 'Effects paused by reduced motion setting'
                : defeated
                  ? 'Duel complete · Reset HP to fight again'
                  : '1 / 2 / 3 to select · Esc to close'}
            </span>
            <button type="button" disabled={busy} onClick={onReset}>
              Reset HP ↻
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
