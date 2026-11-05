/** Redis key the indexer sync job writes: blocks between the chain head and the last block the indexer processed. */
export const INDEXER_LAG_KEY = 'sync:lag';

/** Bumped whenever the sync job copied scores, so cached leaderboard pages stop being served. */
export const LEADERBOARD_VERSION_KEY = 'leaderboard:version';
