import type { NeardataBlock, ReceiptExecutionOutcome } from '../src/neardata/types.js';

/** Our accounts in the fixtures. */
export const CONTRACTS = {
  arena: 'arena.hairto.testnet',
  vault: 'vault.hairto.testnet',
  characters: 'characters.hairto.testnet',
};

export const event = (standard: string, name: string, data: unknown, version = '1.0.0') =>
  `EVENT_JSON:${JSON.stringify({ standard, version, event: name, data })}`;

export const hairto = (name: string, data: unknown) => event('hairto', name, data);

export function outcome(
  executor: string,
  logs: string[],
  over: { id?: string; tx?: string | null; failed?: boolean } = {},
): ReceiptExecutionOutcome {
  return {
    execution_outcome: {
      id: over.id ?? `R-${Math.random().toString(36).slice(2, 10)}`,
      outcome: {
        executor_id: executor,
        logs,
        status: over.failed
          ? {
              Failure: {
                ActionError: { kind: { FunctionCallError: { ExecutionError: 'panic' } } },
              },
            }
          : { SuccessValue: '' },
      },
    },
    tx_hash: over.tx === undefined ? 'TxDefault' : over.tx,
  };
}

/** A Neardata block at `height` (timestamp height seconds after a fixed epoch) with outcomes per shard. */
export function block(height: number, ...shards: ReceiptExecutionOutcome[][]): NeardataBlock {
  return {
    block: {
      header: {
        height,
        timestamp_nanosec: ((1_800_000_000_000n + BigInt(height) * 1_000n) * 1_000_000n).toString(),
      },
    },
    shards: shards.map((receipt_execution_outcomes, shard_id) => ({
      shard_id,
      receipt_execution_outcomes,
    })),
  };
}

export const duelCreated = (duelId: number) =>
  hairto('duel_created', {
    duel_id: duelId,
    fighter: 'fighter.testnet',
    bot: 'rookie.bots.hairto.testnet',
    bot_level: 1,
    asset_id: 2,
    season: 1,
    nonce: 0,
    start_ms: 1_800_000_005_000,
    damage_config_id: 1,
  });
