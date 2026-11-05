import { serialize } from 'borsh';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

import { Dir, type AccountId, type BotLevel } from './types.js';

/**
 * Hashes and signed messages that must match the arena contract byte for byte (`contracts/arena/src/duel.rs`,
 * `merkle.rs`). Parity is tested against `contracts/arena/tests/vectors/*.json`, which the contract tests write.
 */

/** Domain string the bot service signs seed tickets under. */
export const TICKET_DOMAIN = 'hairto-arena/seed-ticket/v1';

const BYTES32 = { array: { type: 'u8', len: 32 } } as const;

const COMMIT_SCHEMA = {
  struct: { dir: 'u8', salt: BYTES32, duel_id: 'u64', player: 'string' },
} as const;

const SEED_SCHEMA = {
  struct: { seed: BYTES32, fighter: 'string', nonce: 'u64' },
} as const;

const TICKET_MESSAGE_SCHEMA = {
  struct: {
    domain: 'string',
    arena: 'string',
    ticket: {
      struct: {
        fighter: 'string',
        asset_id: 'u32',
        bot_level: 'u8',
        seed_hash: BYTES32,
        nonce: 'u64',
        deadline_ms: 'u64',
      },
    },
  },
} as const;

const LEAF_SCHEMA = { struct: { account_id: 'string', amount: 'u128' } } as const;

/** A seed ticket as the arena `start_duel` takes it (bytes here; base64 in JSON). */
export interface SeedTicket {
  fighter: AccountId;
  assetId: number;
  botLevel: BotLevel;
  seedHash: Uint8Array;
  nonce: bigint | number;
  deadlineMs: bigint | number;
}

function require32(bytes: Uint8Array, name: string): number[] {
  if (bytes.length !== 32) throw new Error(`${name} must be 32 bytes`);
  return Array.from(bytes);
}

/** `sha256(borsh((dir: u8, salt: [u8; 32], duel_id: u64, player: String)))`, Long = 1 and Short = 2. */
export function commitHash(
  dir: Dir.Long | Dir.Short,
  salt: Uint8Array,
  duelId: bigint | number,
  player: AccountId,
): Uint8Array {
  if (dir !== Dir.Long && dir !== Dir.Short) throw new Error('dir must be Long or Short');
  return sha256(
    serialize(COMMIT_SCHEMA, {
      dir,
      salt: require32(salt, 'salt'),
      duel_id: BigInt(duelId),
      player,
    }),
  );
}

/** `sha256(borsh((seed: [u8; 32], fighter: String, nonce: u64)))`. */
export function seedHash(seed: Uint8Array, fighter: AccountId, nonce: bigint | number): Uint8Array {
  return sha256(serialize(SEED_SCHEMA, { seed: require32(seed, 'seed'), fighter, nonce: BigInt(nonce) }));
}

/** The exact bytes the bot service signs: `borsh(TicketMessage { domain, arena, ticket })`. */
export function ticketMessage(arena: AccountId, ticket: SeedTicket): Uint8Array {
  return serialize(TICKET_MESSAGE_SCHEMA, {
    domain: TICKET_DOMAIN,
    arena,
    ticket: {
      fighter: ticket.fighter,
      asset_id: ticket.assetId,
      bot_level: ticket.botLevel,
      seed_hash: require32(ticket.seedHash, 'seed_hash'),
      nonce: BigInt(ticket.nonce),
      deadline_ms: BigInt(ticket.deadlineMs),
    },
  });
}

/** Season payout leaf: `keccak256(keccak256(borsh((account_id: String, amount: u128))))`. */
export function merkleLeaf(accountId: AccountId, amount: bigint): Uint8Array {
  return keccak_256(keccak_256(serialize(LEAF_SCHEMA, { account_id: accountId, amount })));
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(text: string): Uint8Array {
  if (text.length % 2 !== 0 || /[^0-9a-f]/i.test(text)) throw new Error('invalid hex');
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.slice(2 * i, 2 * i + 2), 16);
  return out;
}
