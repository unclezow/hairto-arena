import { Injectable } from '@nestjs/common';
import { NetworkError, type FinalExecutionOutcome } from 'near-kit';
import { badRequest, forbidden, notFound, upstreamUnavailable } from '../common/errors.js';
import { ArenaClient } from '../near/arena.client.js';
import { NearService } from '../near/near.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutcomeStream, relayedOutcome } from '../realtime/outcome-stream.js';

export interface RelayResult {
  /** Duel events of this duel found in the transaction and passed to the live view. */
  events: number;
}

/**
 * A Fighter's own transaction (start, open, close) for the live duel view. Only the hash comes from the client:
 * the outcome is fetched from RPC with the Fighter as sender, and only the arena's logs for this duel are kept.
 */
@Injectable()
export class DuelTxRelayService {
  constructor(
    private readonly near: NearService,
    private readonly arena: ArenaClient,
    private readonly prisma: PrismaService,
    private readonly stream: OutcomeStream,
  ) {}

  async relay(duelId: bigint, accountId: string, txHash: string): Promise<RelayResult> {
    const fighter = await this.fighterOf(duelId);
    if (fighter === null) throw notFound('Duel not found');
    if (fighter !== accountId)
      throw forbidden('Only the fighter of this duel may relay its transactions');

    let outcome: FinalExecutionOutcome;
    try {
      outcome = (await this.near.near.getTransactionStatus(
        txHash,
        accountId,
        'EXECUTED_OPTIMISTIC',
      )) as FinalExecutionOutcome;
    } catch (err) {
      if (err instanceof NetworkError) throw upstreamUnavailable('NEAR RPC is unavailable');
      throw badRequest('Unknown or failed transaction');
    }
    if (outcome.transaction?.signer_id !== accountId || outcome.transaction?.hash !== txHash) {
      throw forbidden('The transaction was not sent by this fighter');
    }

    const entry = relayedOutcome(outcome, this.arena.contractId, Number(duelId));
    if (!entry) return { events: 0 };
    await this.stream.push(entry);
    return { events: entry.receipts.reduce((n, r) => n + r.logs.length, 0) };
  }

  /** The chain first: a duel that just started is not indexed yet. A pruned one is only in the database. */
  private async fighterOf(duelId: bigint): Promise<string | null> {
    const onChain = await this.arena.getDuel(duelId);
    if (onChain) return onChain.fighter;
    const row = await this.prisma.duel.findUnique({
      where: { id: duelId },
      select: { fighterAddress: true },
    });
    return row?.fighterAddress ?? null;
  }
}
