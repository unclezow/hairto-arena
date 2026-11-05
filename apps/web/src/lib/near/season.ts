import { viewClient } from './client';
import type { NearConfig } from './config';

export interface SeasonView {
  season: number;
  phase: 'Picking' | 'Active' | 'Closed' | 'ResultsPosted' | 'Finalized';
  start_ms: number;
  pick_end_ms: number;
  end_ms: number;
  pot: string;
  results: { claim_opens_ms: number; rolled_over: boolean } | null;
}

const view = async <T>(config: NearConfig, method: string, args: object = {}): Promise<T> =>
  (await viewClient(config).view<T>(config.contracts.arena, method, args)) as T;

/** Typed views of the arena's season, pick, pot and claim state. */
export const seasonViews = (config: NearConfig) => ({
  currentSeason: () => view<number>(config, 'current_season'),
  getSeason: (season: number) => view<SeasonView | null>(config, 'get_season', { season }),
  pickOf: (season: number, backer: string) => view<string | null>(config, 'pick_of', { season, backer }),
  isClaimed: (season: number, kind: 'Prize' | 'Bonus', accountId: string) =>
    view<boolean>(config, 'is_claimed', { season, kind, account_id: accountId }),
  potOf: async (season: number) => BigInt(await view<string>(config, 'pot_of', { season })),
  fundingSeason: () => view<number>(config, 'funding_season'),
});

/** Merkle proof nodes from the API are hex; the arena takes base64. */
export const hexProofToBase64 = (proof: string[]) =>
  proof.map((hex) => {
    const clean = hex.replace(/^0x/i, '');
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  });
