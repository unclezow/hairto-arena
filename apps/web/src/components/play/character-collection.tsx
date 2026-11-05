'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useState } from 'react';
import { CHARACTERS } from '@hairto-arena/shared';
import { useCharacterCatalog, useCharacterStore, useOwnedCharacters } from '@/hooks/use-lobby-data';
import { useBalances } from '@/hooks/use-balances';
import { cardState } from '@/lib/near/characters';
import { formatAmount } from '@/lib/amount';
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
  const store = useCharacterStore();
  const owned = useOwnedCharacters();
  const balances = useBalances();
  const [buying, setBuying] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
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
              {(() => {
                const chain = store.byId(fighter.id);
                const state =
                  fighter.id === 0
                    ? owned.equipped === 0
                      ? 'equipped'
                      : 'owned'
                    : cardState(chain, owned.owns(fighter.id), owned.equipped === fighter.id);
                const price = chain ? BigInt(chain.price) : null;
                const short = price !== null && balances.usdc < price;
                const label =
                  state === 'equipped'
                    ? 'EQUIPPED'
                    : state === 'owned'
                      ? 'OWNED'
                      : state === 'sold_out'
                        ? 'SOLD OUT'
                        : state === 'unavailable'
                          ? 'UNAVAILABLE'
                          : buying === fighter.id
                            ? 'BUYING…'
                            : 'BUY';
                return (
                  <button
                    type="button"
                    className="armory-card-price"
                    disabled={state !== 'for_sale' || short || buying !== null}
                    title={notice?.id === fighter.id ? notice.text : short ? 'Get USDC first' : undefined}
                    aria-label={
                      state === 'for_sale' && price !== null
                        ? `Buy ${look.title} for ${formatAmount(price, 6)} USDC`
                        : `${look.title}: ${label.toLowerCase()}`
                    }
                    onClick={async () => {
                      setBuying(fighter.id);
                      setNotice(null);
                      try {
                        const problem = await store.buy(fighter.id);
                        setNotice({ id: fighter.id, text: problem ?? 'Purchased!' });
                      } catch (error) {
                        setNotice({ id: fighter.id, text: (error as Error).message.split('\n')[0]! });
                      } finally {
                        setBuying(null);
                      }
                    }}
                  >
                    <span className="armory-buy-label">{label}</span>
                    <Image src="/play/currencies/usdc-coin-v1.png" alt="USDC" width={28} height={28} />
                    <strong>{price === null ? '—' : formatAmount(price, 6)}</strong>
                    <small>USDC</small>
                  </button>
                );
              })()}
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
