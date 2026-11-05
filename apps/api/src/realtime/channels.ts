/** Redis pub/sub channels bridging the worker process to Socket.IO rooms. */
export const CHANNELS = {
  duel: (duelId: string) => `duel:${duelId}`,
  price: (assetId: number) => `price:${assetId}`,
  season: (seasonId: number) => `season:${seasonId}`,
  duelPattern: 'duel:*',
  pricePattern: 'price:*',
  seasonPattern: 'season:*',
  /** API -> worker: a fighter asked to start a duel. */
  botRequests: 'bot:requests',
  /** Worker -> API: the answer to one bot request. */
  botReply: (requestId: string) => `bot:replies:${requestId}`,
} as const;

/** Socket.IO room names. */
export const ROOMS = {
  duel: (duelId: string) => `duel:${duelId}`,
  price: (assetId: number) => `price:${assetId}`,
  season: (seasonId: number) => `season:${seasonId}`,
} as const;
