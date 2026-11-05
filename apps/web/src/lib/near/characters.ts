import { viewClient } from './client';
import type { NearConfig } from './config';

export interface ChainCharacter {
  token_id: string;
  name: string;
  price: string;
  max_supply: number;
  minted: number;
  active: boolean;
}

/** Store state of one character card. */
export type CardState = 'equipped' | 'owned' | 'sold_out' | 'unavailable' | 'for_sale';

export function cardState(c: ChainCharacter | undefined, owned: boolean, equipped: boolean): CardState {
  if (equipped) return 'equipped';
  if (owned) return 'owned';
  if (!c || !c.active) return 'unavailable';
  if (c.max_supply > 0 && c.minted >= c.max_supply) return 'sold_out';
  return 'for_sale';
}

/** Purchase refusals from `purchase_rejected`. */
export function purchaseRejectionText(reason: string) {
  const text: Record<string, string> = {
    already_owned: 'You already own this character.',
    sold_out: 'This character is sold out.',
    underpaid: 'The price changed. Try again.',
    not_for_sale: 'This character is not for sale.',
    paused: 'The store is paused.',
    bad_msg: 'The store could not read the purchase.',
  };
  return `${text[reason] ?? 'The store refused the purchase.'} Your USDC was returned.`;
}

const view = async <T>(config: NearConfig, method: string, args: object = {}): Promise<T> =>
  (await viewClient(config).view<T>(config.contracts.characters, method, args)) as T;

export const characterViews = (config: NearConfig) => ({
  getCharacters: () => view<ChainCharacter[]>(config, 'get_characters'),
  getCharacter: (id: string) => view<ChainCharacter | null>(config, 'get_character', { token_id: id }),
  balances: async (accountId: string, ids: string[]) =>
    (await view<string[]>(config, 'mt_batch_balance_of', { account_id: accountId, token_ids: ids })).map((b) => BigInt(b)),
  equippedOf: (accountId: string) => view<string>(config, 'equipped_of', { account_id: accountId }),
});
