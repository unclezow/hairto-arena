import type { PrismaService } from '../prisma/prisma.service.js';
import { MARKETS } from './markets.js';

export const arenaName = (symbol: string) => `${symbol} Arena`;

/**
 * One feed and one always-open arena per market. Market hours are enforced by the market calendar in code, not
 * by the arena window. Asset ids and feed ids must match the arena contract's assets (`get_assets`).
 */
export async function seedArenas(prisma: PrismaService) {
  for (const market of MARKETS) {
    const feed = { feedId: market.feedId, symbol: market.symbol, marketHoursOnly: false };
    await prisma.assetFeed.upsert({
      where: { assetId: market.assetId },
      create: { assetId: market.assetId, ...feed },
      update: feed,
    });

    const arena = {
      assetId: market.assetId,
      fallbackAssetId: null,
      sessionStartMin: null,
      sessionEndMin: null,
      weekdayMask: 127,
      active: true,
    };
    await prisma.arena.upsert({
      where: { name: arenaName(market.symbol) },
      create: { name: arenaName(market.symbol), ...arena },
      update: arena,
    });
  }
}
