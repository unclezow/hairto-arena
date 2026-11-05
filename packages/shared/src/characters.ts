/**
 * Character metadata (cosmetic). One source for the web app (served at `/characters/{id}.json`, the NEP-245
 * `base_uri` + `reference` of the `characters` contract) and the API. Prices, supply and ownership are on-chain;
 * only names and assets live here. Ids follow the catalog listed on `characters.hairto.testnet` (1–4; 0 is the
 * free default and is never minted).
 */
export interface CharacterMetadata {
  id: number;
  name: string;
  description: string;
  /** glTF model under apps/web/public. */
  model: string;
  /** False when the model file is not in the repo yet. */
  modelAvailable: boolean;
}

/** Id 0 is the free default every account owns without a token. */
export const DEFAULT_CHARACTER_ID = 0;

export const CHARACTERS: readonly CharacterMetadata[] = [
  {
    id: 0,
    name: 'Knight',
    description: 'The default fighter. Free for everyone.',
    model: '/arena/characters/Knight.glb',
    modelAvailable: true,
  },
  {
    id: 1,
    name: 'Mage',
    description: 'Cosmetic character from the KayKit Adventurers pack.',
    model: '/arena/characters/Mage.glb',
    modelAvailable: true,
  },
  {
    id: 2,
    name: 'Rogue',
    description: 'Cosmetic character from the KayKit Adventurers pack.',
    model: '/arena/characters/Rogue.glb',
    modelAvailable: true,
  },
  {
    id: 3,
    name: 'Rogue (Hooded)',
    description: 'Cosmetic character from the KayKit Adventurers pack.',
    model: '/arena/characters/Rogue_Hooded.glb',
    modelAvailable: true,
  },
  {
    id: 4,
    name: 'Barbarian',
    description: 'Cosmetic character from the KayKit Adventurers pack.',
    model: '/arena/characters/Barbarian.glb',
    modelAvailable: true,
  },
];

/** Bot appearance per level (4 is the Oracle); bots never own characters on-chain. */
export const BOT_CHARACTER_BY_LEVEL: Record<number, number> = { 1: 4, 2: 4, 3: 4, 4: 4 };

export function characterMetadata(id: number): CharacterMetadata {
  return (
    CHARACTERS.find((c) => c.id === id) ?? {
      id,
      name: `Character #${id}`,
      description: '',
      model: CHARACTERS[0]!.model,
      modelAvailable: false,
    }
  );
}

/** A character as the API returns it. Amounts are decimal strings in USDC (mock) base units. */
export interface CharacterView extends CharacterMetadata {
  price: string;
  /** 0 = unlimited. */
  maxSupply: number;
  minted: number;
  /** Null when unlimited. */
  supplyLeft: number | null;
  active: boolean;
  purchasable: boolean;
}
