import { decodeBlock, type ContractIds, type DecodedEvent } from './decode.js';
import type { NeardataClient } from './neardata/client.js';
import type { Clock } from './neardata/rate-limiter.js';
import { realClock } from './neardata/rate-limiter.js';
import type { TransactionsApi } from './neardata/tx-api.js';

/** Where decoded blocks go. `apply` writes a block's events and moves the cursor to it in one transaction. */
export interface BlockSink {
  /** Last processed height, or null before the first block. */
  cursor(): Promise<number | null>;
  apply(height: number, events: DecodedEvent[]): Promise<void>;
  /** Moves the cursor without writing events (skipped heights, gap-fill jumps, dev reset). */
  setCursor(height: number): Promise<void>;
  /** Remembers the final head, for the lag the API reports. */
  noteHead(height: number): Promise<void>;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

export interface IngestOptions {
  neardata: NeardataClient;
  /** Without it there is no gap-fill, only sequential catch-up. */
  txApi?: TransactionsApi;
  sink: BlockSink;
  contracts: ContractIds;
  /** First height to index (the deployment block). */
  startBlock: number;
  gapFillThreshold?: number;
  gapFillSafety?: number;
  /**
   * Blocks after a transaction's block in which its receipts may still execute; gap-fill reads all of them. Our
   * deepest chain (harvest: mint, `ft_transfer_call`, `ft_on_transfer`, resolve) fits well inside.
   */
  receiptWindow?: number;
  /** Development only: skip whatever lies between the cursor and the head. */
  resetToHead?: boolean;
  /** Pause at the head before asking again. */
  waitMs?: number;
  clock?: Clock;
  log?: Logger;
}

export type StepResult = 'processed' | 'skipped' | 'waiting' | 'gap-filled' | 'reset';

const silent: Logger = { info: () => undefined, warn: () => undefined };

/**
 * Indexes final blocks one height at a time from the cursor. A `null` height below the final head was skipped by
 * the chain and is passed over; at the head the indexer waits. Far behind, it gap-fills: it asks the Transactions
 * API which transactions touched our contracts, reads only the blocks where their receipts ran, and jumps close to
 * the head. Any gap-fill failure falls back to sequential mode.
 */
export class Ingest {
  private readonly clock: Clock;
  private readonly log: Logger;
  private resetPending: boolean;

  constructor(private readonly o: IngestOptions) {
    this.clock = o.clock ?? realClock;
    this.log = o.log ?? silent;
    this.resetPending = o.resetToHead ?? false;
  }

  private async position(): Promise<number> {
    return (await this.o.sink.cursor()) ?? this.o.startBlock - 1;
  }

  async step(): Promise<StepResult> {
    const cursor = await this.position();
    const head = await this.o.neardata.finalHead();
    await this.o.sink.noteHead(head);

    if (this.resetPending) {
      this.resetPending = false;
      if (head > cursor) {
        await this.o.sink.setCursor(head);
        this.log.warn(`INDEXER_RESET_TO_HEAD: skipped heights ${cursor + 1}..${head}`);
        return 'reset';
      }
    }

    const threshold = this.o.gapFillThreshold ?? 300;
    if (this.o.txApi && head - cursor > threshold) {
      try {
        await this.gapFill(cursor, head);
        return 'gap-filled';
      } catch (err) {
        this.log.warn(`Gap-fill failed, continuing sequentially: ${(err as Error).message}`);
      }
    }

    const next = (await this.position()) + 1;
    const block = await this.o.neardata.block(next);
    if (block) {
      await this.o.sink.apply(next, decodeBlock(block, this.o.contracts));
      return 'processed';
    }
    if (next < head) {
      // A height the chain skipped: nothing to index there.
      await this.o.sink.setCursor(next);
      return 'skipped';
    }
    await this.clock.sleep(this.o.waitMs ?? 1_000);
    return 'waiting';
  }

  /** Processes only the blocks that can hold our events between the cursor and `head − safety`. */
  async gapFill(cursor: number, head: number): Promise<void> {
    const api = this.o.txApi!;
    const to = head - (this.o.gapFillSafety ?? 120);
    if (to <= cursor) return;
    const window = this.o.receiptWindow ?? 8;

    const heights = new Set<number>();
    let txs = 0;
    for (const account of Object.values(this.o.contracts)) {
      for (const tx of await api.receiverTxs(account, cursor + 1, to)) {
        txs++;
        for (let h = tx.tx_block_height; h <= tx.tx_block_height + window; h++) {
          if (h > cursor && h <= to) heights.add(h);
        }
      }
    }
    const ordered = [...heights].sort((a, b) => a - b);
    this.log.info(
      `Gap-fill ${cursor + 1}..${to}: ${txs} transaction(s), ${ordered.length} block(s) to read`,
    );
    for (const height of ordered) {
      const block = await this.o.neardata.block(height);
      if (block) await this.o.sink.apply(height, decodeBlock(block, this.o.contracts));
    }
    await this.o.sink.setCursor(to);
  }

  /** Steps until `signal` aborts. A failed step is logged and retried after a pause. */
  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.step();
      } catch (err) {
        this.log.warn(`Ingest step failed: ${(err as Error).message}`);
        await this.clock.sleep(this.o.waitMs ?? 1_000);
      }
    }
  }
}
