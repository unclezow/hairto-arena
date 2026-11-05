'use client';

import Image from 'next/image';
import { useId, useState } from 'react';

const ARENAS = [
  { name: 'Floating Grounds', theme: 'SKY ISLANDS', image: 'floating-grounds' },
  { name: 'Ember Rift', theme: 'VOLCANIC WILDS', image: 'ember-rift' },
  { name: 'Frostfall Keep', theme: 'FROZEN RUINS', image: 'frostfall-keep' },
] as const;

export function ArenaCollection({ onOpen }: { onOpen: () => void }) {
  const id = useId();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = ARENAS[selectedIndex]!;
  return (
    <figure
      className="hub-arena-preview hub-arena-collection"
      aria-label={`Arena preview: ${selected.name}`}
    >
      <div className="hub-arena-miniature">
        <Image
          src={`/play/arenas/${selected.image}-diorama-v1.png`}
          alt={`${selected.name} arena diorama`}
          width={1280}
          height={1280}
          sizes="(max-width: 700px) 235px, (max-width: 800px) 205px, (max-width: 1100px) 245px, 330px"
          draggable={false}
        />
      </div>
      <figcaption className="hub-arena-preview-caption">
        <span>
          <i /> {selectedIndex === 0 ? 'CURRENT ARENA' : 'ARENA PREVIEW'}
        </span>
        <strong>{selected.name}</strong>
        <small>
          {selected.theme} · {selectedIndex === 0 ? 'SOLO' : 'PREVIEW'}
        </small>
      </figcaption>
      <button
        type="button"
        className="hub-arena-browse"
        popoverTarget={id}
        aria-label="Browse all three arenas"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          if (!open) onOpen();
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="m9 5 7 7-7 7"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>{selectedIndex + 1} / 3</span>
      </button>
      <div
        id={id}
        popover="auto"
        className="hub-arena-gallery"
        aria-labelledby={titleId}
        onToggle={(event) => setOpen(event.currentTarget.matches(':popover-open'))}
      >
        <div className="hub-arena-gallery-heading">
          <div>
            <span>EXPLORE THE BATTLEGROUNDS</span>
            <h2 id={titleId}>Explore the arenas</h2>
          </div>
          <button
            type="button"
            popoverTarget={id}
            popoverTargetAction="hide"
            aria-label="Close arena collection"
          >
            ×
          </button>
        </div>
        <div className="hub-arena-gallery-cards">
          {ARENAS.map((arena, index) => (
            <article
              key={arena.name}
              className={`hub-arena-card${index === selectedIndex ? ' is-current' : ''}`}
            >
              <div className="hub-arena-card-top">
                <span>ARENA 0{index + 1}</span>
                <span>{index === selectedIndex ? 'VIEWING' : 'PREVIEW'}</span>
              </div>
              <div className="hub-arena-card-art">
                <Image
                  src={`/play/arenas/${arena.image}-diorama-v1.png`}
                  alt={`${arena.name} arena diorama`}
                  width={1280}
                  height={1280}
                  sizes="(max-width: 650px) 70vw, 280px"
                  draggable={false}
                />
              </div>
              <div className="hub-arena-card-copy">
                <span>{arena.theme}</span>
                <h3>{arena.name}</h3>
              </div>
              <button
                type="button"
                className="hub-arena-card-action"
                popoverTarget={id}
                popoverTargetAction="hide"
                onClick={() => {
                  setSelectedIndex(index);
                  onOpen();
                }}
              >
                {index === selectedIndex ? (
                  <>
                    <span>✓</span> VIEWING
                  </>
                ) : (
                  'VIEW ARENA'
                )}
              </button>
            </article>
          ))}
        </div>
        <p className="hub-arena-gallery-note">Explore all three battleground designs.</p>
      </div>
    </figure>
  );
}
