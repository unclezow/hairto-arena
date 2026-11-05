import type { DecodedEvent } from '../src/decode.js';
import { HANDLERS } from '../src/handlers/index.js';
import { MemoryStore } from '../src/handlers/memory-store.js';
import { Ingest, type BlockSink } from '../src/ingest.js';
import type { NeardataClient } from '../src/neardata/client.js';
import type { NeardataBlock } from '../src/neardata/types.js';
import type { AccountTx, TransactionsApi } from '../src/neardata/tx-api.js';
import { block, CONTRACTS, duelCreated, hairto, outcome } from './fixtures.js';

/** A chain of final blocks; heights without a block return null. */
class FakeNeardata {
  blocks = new Map<number, NeardataBlock>();
  head = 0;
  fetched: number[] = [];
  async finalHead() {
    return this.head;
  }
  async block(height: number) {
    this.fetched.push(height);
    return this.blocks.get(height) ?? null;
  }
  add(b: NeardataBlock) {
    this.blocks.set(b.block.header.height, b);
    this.head = Math.max(this.head, b.block.header.height);
  }
}

/** Applies events through the real handlers into a MemoryStore, like PgSink does into Postgres. */
class MemorySink implements BlockSink {
  store = new MemoryStore();
  applied: number[] = [];
  raw: DecodedEvent[] = [];
  head: number | null = null;
  private at: number | null = null;
  async cursor() {
    return this.at;
  }
  async apply(height: number, events: DecodedEvent[]) {
    for (const ev of events) {
      this.raw.push(ev);
      const handler = HANDLERS[`${ev.standard}:${ev.event}`];
      if (handler && handler.from === ev.role) await handler.handle(ev as never, this.store);
    }
    this.applied.push(height);
    this.at = height;
  }
  async setCursor(height: number) {
    this.at = height;
  }
  async noteHead(height: number) {
    this.head = height;
  }
}

const noSleep = { now: () => 0, sleep: async () => undefined };

function ingest(
  neardata: FakeNeardata,
  sink: MemorySink,
  over: Partial<ConstructorParameters<typeof Ingest>[0]> = {},
) {
  return new Ingest({
    neardata: neardata as unknown as NeardataClient,
    sink,
    contracts: CONTRACTS,
    startBlock: 100,
    clock: noSleep,
    ...over,
  });
}

describe('sequential ingest', () => {
  it('processes blocks 100 and 101 in order and ends with the cursor at 101', async () => {
    const chain = new FakeNeardata();
    chain.add(block(100, [outcome(CONTRACTS.arena, [duelCreated(1)])]));
    chain.add(block(101, [outcome(CONTRACTS.arena, [duelCreated(2)])]));
    const sink = new MemorySink();
    const run = ingest(chain, sink);
    await expect(run.step()).resolves.toBe('processed');
    await expect(run.step()).resolves.toBe('processed');
    expect(sink.applied).toEqual([100, 101]);
    await expect(sink.cursor()).resolves.toBe(101);
    expect(sink.store.all('duel').map((d) => d.id)).toEqual([1n, 2n]);
    expect(sink.head).toBe(101);
  });

  it('skips a null height below the final head and fetches the next one', async () => {
    const chain = new FakeNeardata();
    chain.add(block(100));
    chain.add(block(102));
    chain.head = 150;
    const sink = new MemorySink();
    const run = ingest(chain, sink);
    await run.step();
    await expect(run.step()).resolves.toBe('skipped');
    await expect(sink.cursor()).resolves.toBe(101);
    await expect(run.step()).resolves.toBe('processed');
    expect(chain.fetched).toEqual([100, 101, 102]);
  });

  it('waits and retries at the head', async () => {
    const chain = new FakeNeardata();
    chain.add(block(100));
    const sink = new MemorySink();
    const run = ingest(chain, sink);
    await run.step();
    await expect(run.step()).resolves.toBe('waiting');
    await expect(run.step()).resolves.toBe('waiting');
    await expect(sink.cursor()).resolves.toBe(100);
    chain.add(block(101));
    await expect(run.step()).resolves.toBe('processed');
  });

  it('jumps to the head once with the development reset', async () => {
    const chain = new FakeNeardata();
    chain.head = 5_000;
    chain.add(block(5_001));
    const sink = new MemorySink();
    const run = ingest(chain, sink, { resetToHead: true });
    await expect(run.step()).resolves.toBe('reset');
    await expect(sink.cursor()).resolves.toBe(5_001);
  });
});

/** A harvest: the vault receives the call in 1 000, logs `vault_harvested` in 1 001, the pot reaches the arena in 1 003. */
function harvestChain(chain: FakeNeardata) {
  chain.add(block(1_000));
  chain.add(
    block(1_001, [
      outcome(
        CONTRACTS.vault,
        [
          hairto('vault_harvested', {
            fighter: { fee: '5', pot: '95', owners: '0' },
            backer: { fee: '0', pot: '0', owners: '0' },
            fee: '5',
            pot: '95',
          }),
        ],
        { tx: 'HarvestTx' },
      ),
    ]),
  );
  chain.add(
    block(1_003, [
      outcome(CONTRACTS.arena, [hairto('pot_funded', { season: 1, amount: '95', pot: '95' })], {
        tx: 'HarvestTx',
      }),
    ]),
  );
  chain.add(
    block(1_010, [
      outcome(CONTRACTS.arena, [
        hairto('season_started', {
          season: 1,
          start_ms: 1,
          pick_end_ms: 2,
          end_ms: 3,
          asset_ids: [2],
        }),
      ]),
    ]),
  );
}

function txApi(txs: Record<string, AccountTx[]>, fail = false) {
  const calls: string[] = [];
  const api = {
    receiverTxs: async (account: string) => {
      calls.push(account);
      if (fail) throw new Error('Transactions API: HTTP 503');
      return txs[account] ?? [];
    },
  } as unknown as TransactionsApi;
  return { api, calls };
}

describe('gap-fill', () => {
  it('reads only the blocks where our transactions ran, including later receipts, then jumps near the head', async () => {
    const chain = new FakeNeardata();
    harvestChain(chain);
    chain.head = 7_000;
    const { api } = txApi({
      [CONTRACTS.vault]: [{ transaction_hash: 'HarvestTx', tx_block_height: 1_000 }],
      [CONTRACTS.arena]: [
        { transaction_hash: 'HarvestTx', tx_block_height: 1_000 },
        { transaction_hash: 'SeasonTx', tx_block_height: 1_010 },
      ],
    });
    const sink = new MemorySink();
    await sink.setCursor(999);
    const run = ingest(chain, sink, { txApi: api });
    await expect(run.step()).resolves.toBe('gap-filled');
    await expect(sink.cursor()).resolves.toBe(7_000 - 120);
    // 1 000..1 008 for the harvest and 1 010..1 018 for the season start: never all 6 000 heights.
    expect(chain.fetched.length).toBeLessThanOrEqual(18);
    expect(sink.applied).toEqual([1_000, 1_001, 1_003, 1_010]);
    expect(sink.store.get('harvest', { id: 'HarvestTx-fighter' })).toMatchObject({ toPot: 95n });
  });

  it('produces the same chain tables as sequential processing of the same range', async () => {
    const sequential = new FakeNeardata();
    harvestChain(sequential);
    const seqSink = new MemorySink();
    await seqSink.setCursor(999);
    const seq = ingest(sequential, seqSink);
    while ((await seqSink.cursor())! < 1_010) await seq.step();

    const sparse = new FakeNeardata();
    harvestChain(sparse);
    sparse.head = 1_010 + 120 + 400;
    const { api } = txApi({
      [CONTRACTS.vault]: [{ transaction_hash: 'HarvestTx', tx_block_height: 1_000 }],
      [CONTRACTS.arena]: [
        { transaction_hash: 'HarvestTx', tx_block_height: 1_000 },
        { transaction_hash: 'SeasonTx', tx_block_height: 1_010 },
      ],
    });
    const gapSink = new MemorySink();
    await gapSink.setCursor(999);
    await ingest(sparse, gapSink, { txApi: api }).step();

    expect([...gapSink.store.rows.entries()]).toEqual([...seqSink.store.rows.entries()]);
    expect(gapSink.raw.map((e) => [e.block.height, e.position.logIndex, e.event])).toEqual(
      seqSink.raw.map((e) => [e.block.height, e.position.logIndex, e.event]),
    );
  });

  it('falls back to sequential mode when the Transactions API fails', async () => {
    const chain = new FakeNeardata();
    harvestChain(chain);
    chain.head = 7_000;
    const warnings: string[] = [];
    const { api } = txApi({}, true);
    const sink = new MemorySink();
    await sink.setCursor(999);
    const run = ingest(chain, sink, {
      txApi: api,
      log: { info: () => undefined, warn: (m) => warnings.push(m) },
    });
    await expect(run.step()).resolves.toBe('processed');
    await expect(sink.cursor()).resolves.toBe(1_000);
    expect(warnings[0]).toMatch(/Gap-fill failed.*HTTP 503/);
  });

  it('stays sequential within the threshold', async () => {
    const chain = new FakeNeardata();
    harvestChain(chain);
    chain.head = 1_200;
    const { api, calls } = txApi({});
    const sink = new MemorySink();
    await sink.setCursor(999);
    await expect(ingest(chain, sink, { txApi: api }).step()).resolves.toBe('processed');
    expect(calls).toEqual([]);
  });
});
