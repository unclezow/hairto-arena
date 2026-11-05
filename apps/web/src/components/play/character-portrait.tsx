import Image from 'next/image';

/** Frontend artwork only; IDs match the existing catalog without changing metadata or ownership. */
const PORTRAITS: Record<number, string> = {
  0: 'knight',
  1: 'mage',
  2: 'rogue',
  3: 'rogue-hooded',
  4: 'barbarian',
};

export function characterPortrait(id: number) {
  return `/play/leaderboard/${PORTRAITS[id] ?? PORTRAITS[0]}-portrait-v1.png`;
}

export function CharacterPortrait({ id = 0, size = 96 }: { id?: number; size?: number }) {
  return (
    <Image
      className="game-character-portrait"
      src={characterPortrait(id)}
      alt=""
      width={size}
      height={size}
      sizes={`${size}px`}
      draggable={false}
    />
  );
}
