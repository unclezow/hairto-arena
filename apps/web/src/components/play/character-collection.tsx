'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useState } from 'react';
import { featureReady } from '@/lib/features';
import { CHARACTERS } from '@hairto-arena/shared';
import { useCharacterCatalog } from '@/hooks/use-lobby-data';
import { CharacterPortrait } from './character-portrait';

const Fighter = dynamic(() => import('./lobby-fighter'), {
  ssr: false,
  loading: () => <span className="armory-summoning">SUMMONING…</span>,
});

const PRESENTATION: Record<number, { title: string; detail: string; emblem: string }> = {
  0: {
    title: 'The Sentinel',
    detail: 'Steel, resolve, and a shield that never falters.',
    emblem: '✧',
  },
  1: { title: 'The Arcanist', detail: 'Ancient spells. A spark of untamed magic.', emblem: '✦' },
  2: { title: 'The Shadowblade', detail: 'Swift blades and a fearless spirit.', emblem: 'Ⅱ' },
  3: {
    title: 'The Nightstalker',
    detail: 'A hooded silhouette. A blade in the shadows.',
    emblem: '◇',
  },
  4: {
    title: 'The Berserker',
    detail: 'An untamed spirit with a taste for the arena.',
    emblem: 'Ⅹ',
  },
};

export default function CharacterCollection() {
  const [previewId, setPreviewId] = useState<number | null>(null);
  const catalog = useCharacterCatalog();
  // Shared metadata keeps all five previews visible while the shop catalog loads.
  const roster = CHARACTERS.filter(
    (fighter) => fighter.modelAvailable && PRESENTATION[fighter.id],
  ).map((fighter) => ({
    ...fighter,
    ...catalog.data?.items.find((item) => item.id === fighter.id),
  }));

  return (
    <div className="armory-collection">
      <div className="armory-collection-heading">
        <div>
          <span>THE FIGHTER COLLECTION</span>
          <h2>Make your entrance.</h2>
        </div>
        <p>
          <span className="armory-fighter-count">
            <b>{String(roster.length).padStart(2, '0')}</b> FIGHTERS
          </span>
          <i />
          <span>SELECT A CARD TO PREVIEW IN 3D</span>
        </p>
      </div>
      <div className="armory-roster" aria-label="All five fighters">
        {roster.map((fighter) => {
          const active = previewId === fighter.id;
          const look = PRESENTATION[fighter.id]!;
          return (
            <article
              key={fighter.id}
              className="armory-fighter"
              data-character={fighter.id}
              data-preview={active}
              aria-label={look.title}
            >
              <span className="armory-card-top">
                <span>No. {String(fighter.id + 1).padStart(2, '0')}</span>
                <i>{active ? 'LIVE 3D' : 'CHARACTER'}</i>
              </span>
              <span className="armory-fighter-emblem" aria-hidden="true">
                {look.emblem}
              </span>
              <span className="armory-card-visual">
                {active ? (
                  <Fighter
                    modelPath={fighter.model}
                    label={`${fighter.name}, animated 3D preview`}
                    faceForward
                  />
                ) : (
                  <CharacterPortrait id={fighter.id} size={480} />
                )}
              </span>
              <span className="armory-card-copy">
                <small>{fighter.name}</small>
                <strong>{look.title}</strong>
                <span>{look.detail}</span>
              </span>
              <button
                type="button"
                className="armory-card-price"
                disabled={!featureReady('economy')}
                title="Purchases are not available yet"
                aria-label={`Buy ${look.title} for 500 USDC. Demo button.`}
              >
                <span className="armory-buy-label">BUY</span>
                <Image src="/play/currencies/usdc-coin-v1.png" alt="USDC" width={28} height={28} />
                <strong>500</strong>
                <small>USDC</small>
              </button>
              <button
                type="button"
                className="armory-card-action"
                aria-pressed={active}
                onClick={() => setPreviewId(active ? null : fighter.id)}
              >
                <span>{active ? 'CLOSE PREVIEW' : 'PREVIEW IN 3D'}</span>
                <b aria-hidden="true">{active ? '×' : '↗'}</b>
              </button>
            </article>
          );
        })}
      </div>
      <div className="armory-collection-note">
        <span>✦</span>
        <p>
          Five identities. One arena.<small>Choose a fighter to explore their look.</small>
        </p>
        <span>✦</span>
      </div>
    </div>
  );
}
