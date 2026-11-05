/**
 * The parts of a Neardata block (`GET /v0/block/{height}`, the NEAR Lake streamer message) the indexer reads.
 * Everything else in the block is ignored.
 */
export type ExecutionStatus =
  | { SuccessValue: string }
  | { SuccessReceiptId: string }
  | { Failure: unknown }
  | 'Unknown'
  | Record<string, unknown>;

export interface ReceiptExecutionOutcome {
  execution_outcome: {
    /** Receipt id. */
    id: string;
    outcome: {
      executor_id: string;
      logs: string[];
      status: ExecutionStatus;
    };
  };
  /** Hash of the transaction the receipt belongs to (Neardata adds it to each outcome). */
  tx_hash?: string | null;
}

export interface NeardataBlock {
  block: {
    header: {
      height: number;
      /** Nanoseconds since the epoch, as a decimal string. */
      timestamp_nanosec: string;
    };
  };
  shards: { shard_id: number; receipt_execution_outcomes: ReceiptExecutionOutcome[] }[];
}
