import { NearHealthReporter } from './near-health.service.js';

function setup(view: unknown) {
  const stored = new Map<string, string>();
  const near = {
    laneStats: () => ({ pusher: { size: 8, inUse: 1, waiting: 0, sent: 10, failed: 0 } }),
    accountOf: () => 'pusher.hairto.testnet',
    publicKeyOf: () => 'ed25519:PusherKey',
    deployment: { network: 'testnet' },
    near: {
      getAccessKey: async () => {
        if (view instanceof Error) throw view;
        return view;
      },
    },
  };
  const redis = { client: { set: async (k: string, v: string) => void stored.set(k, v) } };
  return { reporter: new NearHealthReporter(near as never, redis as never), stored };
}

describe('NearHealthReporter', () => {
  it('reports lanes in use, the gas-key balance and its nonce lanes', async () => {
    const s = setup({
      permission: {
        GasKeyFunctionCall: {
          balance: '1500000000000000000000000',
          num_nonces: 8,
          receiver_id: 'arena',
          method_names: [],
        },
      },
    });
    const report = await s.reporter.report();
    expect(report.keys.pusher).toMatchObject({
      accountId: 'pusher.hairto.testnet',
      balance: '1500000000000000000000000',
      numNonces: 8,
      lanes: { size: 8, inUse: 1 },
    });
    expect(JSON.parse(s.stored.get('near:health')!)).toMatchObject({ network: 'testnet' });
  });

  it('says what is wrong with a missing key, a plain key or an RPC failure', async () => {
    await expect(setup(null).reporter.report()).resolves.toMatchObject({
      keys: { pusher: { error: 'key not found on the account', balance: null } },
    });
    await expect(setup({ permission: 'FullAccess' }).reporter.report()).resolves.toMatchObject({
      keys: { pusher: { error: 'not a gas key' } },
    });
    await expect(setup(new Error('rpc down')).reporter.report()).resolves.toMatchObject({
      keys: { pusher: { error: 'rpc down' } },
    });
  });
});
