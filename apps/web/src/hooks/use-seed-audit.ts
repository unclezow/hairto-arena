'use client';

import { useQuery } from '@tanstack/react-query';
import { viewClient } from '@/lib/near/client';
import { useNearWallet } from '@/lib/near/context';
import { eventsOf, findEvent } from '@/lib/near/outcome';
import { auditSeed, type SeedAudit } from '@/lib/seed-audit';

/**
 * Local check of the bot's revealed seed against the hash it committed. The Fighter's ticket nonce is read from the
 * `duel_created` event of the duel's own `start_duel` transaction, straight from the RPC.
 */
export function useSeedAudit(args: {
  createdTx: string | null;
  fighter: string | null;
  seed: string | null;
  seedHash: string | null;
}): SeedAudit | null {
  const { config } = useNearWallet();
  const { createdTx, fighter, seed, seedHash } = args;
  const audit = useQuery({
    queryKey: ['seed-audit', createdTx, fighter, seed, seedHash],
    enabled: !!createdTx && !!fighter && !!seed && !!seedHash,
    staleTime: Infinity,
    retry: 2,
    queryFn: async () => {
      const outcome = await viewClient(config).rpc.getTransactionStatus(createdTx!, fighter!);
      const created = findEvent(eventsOf(outcome, config.contracts.arena), 'duel_created');
      if (!created) return null;
      return auditSeed(seed!, fighter!, created.nonce, seedHash!);
    },
  });
  return audit.data ?? null;
}
