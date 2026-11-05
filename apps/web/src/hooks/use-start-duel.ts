'use client';

import type { MarketView } from '@hairto-arena/shared';
import { useCallback } from 'react';
import { api, ApiError } from '@/lib/api';
import { useNearWallet } from '@/lib/near/context';
import { eventsOf, findEvent, txHashOf } from '@/lib/near/outcome';
import { arenaCall } from '@/lib/near/quick-play-key';

/** Until a selector choice is made: the lowest bot level. */
export const DEFAULT_BOT_LEVEL = 1;
/** Until an asset switch exists, duels default to BTC. */
export const DEFAULT_MARKET_SYMBOL = 'BTC';
/** `start_duel` runs a cross-contract eligibility check and its callback. */
const START_GAS_TGAS = 100;
/** A ticket that expires within this margin is renewed before sending. */
const TICKET_MARGIN_MS = 5_000;

/** BTC when open, otherwise the first open market. */
export function pickDefaultMarket(items: MarketView[]): MarketView | null {
  return (
    items.find((m) => m.open && m.symbol === DEFAULT_MARKET_SYMBOL) ??
    items.find((m) => m.open) ??
    null
  );
}

export async function defaultMarket(): Promise<MarketView | null> {
  const { items } = await api<{ items: MarketView[] }>('/markets');
  return pickDefaultMarket(items);
}

export type StartResult =
  | { ok: true; duelId: string; startMs: number }
  | { ok: false; code: string; message: string };

interface TicketResponse {
  ticket: { deadline_ms: number; [key: string]: unknown };
  signature: string;
  deadlineMs: number;
}

/** Contract rejection reasons from `duel_rejected`, mapped to the battle popup codes. */
const REJECTION_CODES: Record<string, string> = {
  not_eligible: 'BELOW_MINIMUM_DEPOSIT',
  vault_error: 'VAULT_ERROR',
};

const failure = (err: unknown): { ok: false; code: string; message: string } => {
  if (err instanceof ApiError) return { ok: false, code: err.code ?? 'ERROR', message: err.message };
  const message = ((err as Error)?.message ?? 'Unknown error').split('\n')[0]!;
  const declined = /reject|denied|declin|cancel/i.test(message);
  return { ok: false, code: declined ? 'SIGN_DECLINED' : 'ERROR', message };
};

/**
 * Starts a duel: asks the bot service for a seed ticket, then the Fighter sends `start_duel(ticket, signature)`
 * itself with the quick-play key (wallet fallback). The duel id, or the reason it was refused, comes from the
 * transaction's own outcome. A ticket that expired while the arena loaded is renewed once without a prompt.
 */
export function useStartDuel() {
  const { config, accountId, wallet } = useNearWallet();

  const start = useCallback(
    async (args: { assetId: number; botLevel: number }): Promise<StartResult> => {
      if (!accountId || !wallet) return { ok: false, code: 'UNAUTHENTICATED', message: 'No wallet connected' };
      try {
        const requestTicket = () =>
          api<TicketResponse>('/duels/ticket', {
            method: 'POST',
            body: JSON.stringify({ assetId: args.assetId, botLevel: args.botLevel }),
          });
        let ticket = await requestTicket();
        if (ticket.deadlineMs < Date.now() + TICKET_MARGIN_MS) ticket = await requestTicket();

        const outcome = await arenaCall(
          config,
          accountId,
          wallet,
          'start_duel',
          { ticket: ticket.ticket, signature: ticket.signature },
          { gasTgas: START_GAS_TGAS },
        );
        const events = eventsOf(outcome, config.contracts.arena);
        const created = findEvent(events, 'duel_created');
        if (created) {
          const duelId = String(created.duel_id);
          const hash = txHashOf(outcome);
          if (hash)
            void api(`/duels/${duelId}/tx`, { method: 'POST', body: JSON.stringify({ txHash: hash }) }).catch(
              () => undefined,
            );
          return { ok: true, duelId, startMs: created.start_ms };
        }
        const rejected = findEvent(events, 'duel_rejected');
        if (rejected)
          return {
            ok: false,
            code: REJECTION_CODES[rejected.reason] ?? 'DUEL_REJECTED',
            message: rejected.reason,
          };
        return { ok: false, code: 'ERROR', message: 'The duel was not created' };
      } catch (err) {
        return failure(err);
      }
    },
    [accountId, config, wallet],
  );

  return { start };
}
