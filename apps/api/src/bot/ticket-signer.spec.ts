import { fromBase64, fromHex, toBase64 } from '@hairto-arena/shared';
import { ed25519 } from '@noble/curves/ed25519.js';
import { generateKey } from 'near-kit';
import hashes from '../../../../contracts/arena/tests/vectors/hashes.json' with { type: 'json' };
import { signTicket } from './ticket-signer.js';

describe('signTicket', () => {
  const key = generateKey();
  const publicKey = key.publicKey.data;

  it('signs exactly the arena ticket message', () => {
    for (const v of hashes.ticket_messages) {
      const ticket = {
        fighter: v.fighter,
        asset_id: v.asset_id,
        bot_level: v.bot_level as 1,
        seed_hash: toBase64(fromHex(v.seed_hash)),
        nonce: Number(v.nonce),
        deadline_ms: Number(v.deadline_ms),
      };
      if (!Number.isSafeInteger(ticket.deadline_ms)) continue;
      const { signature } = signTicket(key.secretKey as never, v.arena, ticket);
      expect(ed25519.verify(fromBase64(signature), fromHex(v.message), publicKey)).toBe(true);
    }
  });

  it('does not verify for another arena', () => {
    const ticket = {
      fighter: 'fighter.testnet',
      asset_id: 2,
      bot_level: 1 as const,
      seed_hash: toBase64(new Uint8Array(32).fill(3)),
      nonce: 0,
      deadline_ms: 1_800_000_030_000,
    };
    const { signature } = signTicket(key.secretKey as never, 'arena.hairto.testnet', ticket);
    const other = hashes.ticket_messages.find((v) => v.arena === 'arena.hairto.testnet')!;
    expect(ed25519.verify(fromBase64(signature), fromHex(other.message), publicKey)).toBe(true);
    const { signature: elsewhere } = signTicket(
      key.secretKey as never,
      'arena2.hairto.testnet',
      ticket,
    );
    expect(ed25519.verify(fromBase64(elsewhere), fromHex(other.message), publicKey)).toBe(false);
  });
});
