import { Injectable } from '@nestjs/common';
import {
  BOT_CHARACTER_BY_LEVEL,
  CHARACTERS,
  DEFAULT_CHARACTER_ID,
  characterMetadata,
  type CharacterView,
} from '@hairto-arena/shared';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Read side of the characters contract (NEP-245, cosmetic). Prices, supply, ownership and equip state come from the
 * indexed chain; names and models from the shared metadata. Buying and equipping happen from the wallet, never
 * through the API.
 */
@Injectable()
export class CharactersService {
  constructor(private readonly prisma: PrismaService) {}

  /** The free default first, then every listed character in id order. */
  async catalog(): Promise<CharacterView[]> {
    const listed = await this.prisma.character.findMany({ orderBy: { id: 'asc' } });
    const free: CharacterView = {
      ...characterMetadata(DEFAULT_CHARACTER_ID),
      price: '0',
      maxSupply: 0,
      minted: 0,
      supplyLeft: null,
      active: true,
      // Everyone owns the default; there is nothing to buy.
      purchasable: false,
    };
    return [
      free,
      ...listed.map((c) => {
        const supplyLeft = c.maxSupply === 0 ? null : Math.max(0, c.maxSupply - c.minted);
        return {
          ...characterMetadata(c.id),
          price: c.price.toFixed(),
          maxSupply: c.maxSupply,
          minted: c.minted,
          supplyLeft,
          active: c.active,
          purchasable: c.active && supplyLeft !== 0,
        };
      }),
    ];
  }

  /** Owned ids (always including the default) and the equipped id, falling back to 0 when no longer held. */
  async ofWallet(accountId: string) {
    const [balances, equip] = await Promise.all([
      this.prisma.characterBalance.findMany({
        where: { address: accountId, amount: { gt: 0 } },
        orderBy: { characterId: 'asc' },
      }),
      this.prisma.characterEquip.findUnique({ where: { address: accountId } }),
    ]);
    const owned = [DEFAULT_CHARACTER_ID, ...balances.map((b) => b.characterId)];
    const equipped =
      equip && owned.includes(equip.characterId) ? equip.characterId : DEFAULT_CHARACTER_ID;
    return { accountId, owned, equipped };
  }

  /** The character `accountId` had equipped at `at` (a duel's creation time), from the equip history. */
  async equippedAt(accountId: string, at: Date): Promise<number> {
    const last = await this.prisma.characterEquipEvent.findFirst({
      where: { address: accountId, equippedAt: { lte: at } },
      orderBy: [{ equippedAt: 'desc' }, { blockNumber: 'desc' }, { logIndex: 'desc' }],
    });
    return last?.characterId ?? DEFAULT_CHARACTER_ID;
  }

  botCharacter(level: number): number {
    return BOT_CHARACTER_BY_LEVEL[level] ?? CHARACTERS[0]!.id;
  }
}
