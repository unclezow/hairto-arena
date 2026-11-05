import { commitHash, fromHex, toBase64, toHex, type Dir } from '@hairto-arena/shared';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { concatBytes, uint256, type Seed } from './seed.js';

/** Base64 commit for `open_position`: sha256(borsh((dir, salt, duel_id, player))), as the arena checks it. */
export function positionCommit(
  dir: Dir.Long | Dir.Short,
  salt: string,
  duelId: bigint | number,
  player: string,
): string {
  return toBase64(commitHash(dir, fromHex(salt), duelId, player));
}

/**
 * Salt (64 hex) of the n-th trade of a duel, derived from the seed so it can be reproduced after the reveal.
 * Off-chain only: the arena just checks the commit.
 */
export function positionSalt(seed: Seed, tradeIndex: number): string {
  return toHex(
    keccak_256(concatBytes(fromHex(seed), new TextEncoder().encode('salt'), uint256(tradeIndex))),
  );
}
