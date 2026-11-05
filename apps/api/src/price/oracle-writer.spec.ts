import type { FinalExecutionOutcome } from 'near-kit';
import type { ArenaClient } from '../near/arena.client.js';
import { NearTickWriter, parseRecordedTicks } from './oracle-writer.js';

const FEED = '11'.repeat(32);

function outcome(logs: string[]): FinalExecutionOutcome {
  return {
    status: { SuccessValue: '' },
    transaction: { hash: 'Tx1' },
    receipts_outcome: [{ outcome: { logs, status: { SuccessValue: '' } } }],
  } as unknown as FinalExecutionOutcome;
}

const pushed = (ticks: object[]) =>
  'EVENT_JSON:' +
  JSON.stringify({ standard: 'hairto', version: '1.0.0', event: 'ticks_pushed', data: { ticks } });

describe('parseRecordedTicks', () => {
  it('reads the tick the arena assigned', () => {
    const [tick] = parseRecordedTicks(
      outcome([
        pushed([
          {
            asset_id: 2,
            index: 41,
            price: 12_300_000_000,
            expo: -8,
            publish_ms: 1_800_000_123_000,
          },
        ]),
      ]),
    );
    expect(tick).toEqual({
      assetId: 2,
      tickIndex: 41,
      price: 12_300_000_000n,
      expo: -8,
      publishMs: 1_800_000_123_000,
    });
  });

  it('ignores logs that are not ticks_pushed events of the arena', () => {
    const other = JSON.stringify({
      standard: 'nep141',
      version: '1',
      event: 'ticks_pushed',
      data: {},
    });
    expect(
      parseRecordedTicks(outcome(['plain log', `EVENT_JSON:${other}`, 'EVENT_JSON:{'])),
    ).toEqual([]);
  });
});

describe('NearTickWriter', () => {
  const env: Record<string, number> = { PRICE_TX_TGAS_BASE: 30, PRICE_TX_TGAS_PER_ASSET: 5 };
  const config = { get: (key: string) => env[key] };

  function setup(overrides: { fails?: boolean; skip?: number[] } = {}) {
    const pushTicks = vi.fn(
      async (ticks: { asset_id: number; price: number; publish_ms: number }[], _tgas: number) => {
        if (overrides.fails) throw new Error('push_ticks failed (Tx9): asset not active');
        const recorded = ticks
          .filter((t) => !overrides.skip?.includes(t.asset_id))
          .map((t, i) => ({ ...t, index: 10 + i, expo: -8 }));
        return { txHash: 'Tx1', value: undefined, outcome: outcome([pushed(recorded)]) };
      },
    );
    const writer = new NearTickWriter({ pushTicks } as unknown as ArenaClient, config as never);
    return { writer, pushTicks };
  }

  const update = (assetId: number, price: bigint, publishMs: number) => ({
    assetId,
    feedId: FEED,
    price,
    expo: -8,
    publishMs,
  });

  it('sends every asset in one push_ticks transaction with ms publish times', async () => {
    const { writer, pushTicks } = setup();
    const result = await writer.push([update(1, 100n, 1_000), update(2, 200n, 2_000)]);
    expect(pushTicks).toHaveBeenCalledTimes(1);
    expect(pushTicks.mock.calls[0]![0]).toEqual([
      { asset_id: 1, price: 100, expo: -8, publish_ms: 1_000 },
      { asset_id: 2, price: 200, expo: -8, publish_ms: 2_000 },
    ]);
    expect(result.ticks.map((t) => [t.assetId, t.tickIndex, t.publishMs])).toEqual([
      [1, 10, 1_000],
      [2, 11, 2_000],
    ]);
    expect(result.failed).toEqual([]);
  });

  it('sends nothing when there is nothing to push', async () => {
    const { writer, pushTicks } = setup();
    expect(await writer.push([])).toEqual({ ticks: [], failed: [] });
    expect(pushTicks).not.toHaveBeenCalled();
  });

  it('sizes the gas per asset, scaled for a retry and capped at 300 Tgas', async () => {
    const { writer, pushTicks } = setup();
    await writer.push([update(1, 1n, 1), update(2, 1n, 1)]);
    await writer.push([update(1, 1n, 2)], { gasMultiplier: 1.5 });
    await writer.push(Array.from({ length: 80 }, (_, i) => update(i + 1, 1n, 3)));
    expect(pushTicks.mock.calls.map((c) => c[1])).toEqual([40, 53, 300]);
  });

  it('treats an entry the arena skipped as no new tick, not a failure', async () => {
    const { writer } = setup({ skip: [2] });
    const result = await writer.push([update(1, 1n, 1), update(2, 1n, 1)]);
    expect(result.ticks.map((t) => t.assetId)).toEqual([1]);
    expect(result.failed).toEqual([]);
  });

  it('reports every asset failed when the transaction fails', async () => {
    const { writer } = setup({ fails: true });
    const result = await writer.push([update(1, 1n, 1), update(3, 1n, 1)]);
    expect(result.ticks).toEqual([]);
    expect(result.failed).toEqual([
      { assetId: 1, error: expect.stringContaining('asset not active') },
      { assetId: 3, error: expect.stringContaining('asset not active') },
    ]);
  });
});
