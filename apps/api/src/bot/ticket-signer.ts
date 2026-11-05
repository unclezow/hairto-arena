import { fromBase64, ticketMessage, toBase64, type BotLevel } from '@hairto-arena/shared';
import { parseKey, type PrivateKey } from 'near-kit';
import type { SeedTicketJson } from '../near/arena.types.js';

export interface SignedTicket {
  ticket: SeedTicketJson;
  /** Base64 ed25519 signature over `ticketMessage(arena, ticket)`, as `start_duel` takes it. */
  signature: string;
}

/**
 * Signs a seed ticket with the bot service key. The message binds the arena account, so a ticket is only good for
 * the arena it was signed for; the Fighter sends it to `start_duel` together with the signature.
 */
export function signTicket(key: PrivateKey, arena: string, ticket: SeedTicketJson): SignedTicket {
  const message = ticketMessage(arena, {
    fighter: ticket.fighter,
    assetId: ticket.asset_id,
    botLevel: ticket.bot_level as BotLevel,
    seedHash: fromBase64(ticket.seed_hash),
    nonce: BigInt(ticket.nonce),
    deadlineMs: BigInt(ticket.deadline_ms),
  });
  const signature = parseKey(key).sign(message).data;
  return { ticket, signature: toBase64(signature) };
}
