import { ConfigService } from '@nestjs/config';
import { generateKey, type FinalExecutionOutcome } from 'near-kit';
import { validateEnv } from '../config/env.js';
import { NearCallError, NearService, decodeOutcome } from './near.service.js';

function service(raw: Record<string, string> = {}) {
  return new NearService(new ConfigService(validateEnv(raw)) as never);
}

function outcome(status: unknown, receipts: unknown[] = []): FinalExecutionOutcome {
  return {
    status,
    transaction: { hash: 'TxHash111' },
    receipts_outcome: receipts.map((s) => ({ outcome: { status: s } })),
  } as unknown as FinalExecutionOutcome;
}

describe('NearService', () => {
  const pusher = generateKey();
  const keeper = generateKey();
  const keeperVault = generateKey();
  const bot2 = generateKey();

  it('uses the manifest ids unless the environment overrides them', () => {
    const near = service({ ARENA_ID: 'arena2.hairto.testnet' });
    expect(near.contracts.arena).toBe('arena2.hairto.testnet');
    expect(near.contracts.vault).toBe('vault.hairto.testnet');
    expect(near.deployment.rpcUrl).toBe('https://test.rpc.fastnear.com');
    expect(service({ NEAR_RPC_URL: 'https://rpc.example' }).deployment.rpcUrl).toBe(
      'https://rpc.example',
    );
  });

  it('has no signer without keys', () => {
    const near = service();
    expect(near.hasSigner('pusher')).toBe(false);
    expect(near.botLevels()).toEqual([]);
    expect(near.ticketKey()).toBeUndefined();
    expect(near.laneStats()).toEqual({});
    expect(near.accountOf('keeper')).toBe('keeper.hairto.testnet');
    expect(near.botAccount(4)).toBe('oracle.bots.hairto.testnet');
  });

  it('creates one signer per configured role with lanes for gas keys only', () => {
    const near = service({
      PUSHER_GAS_KEY: pusher.secretKey,
      PUSHER_GAS_KEY_LANES: '4',
      KEEPER_KEY: keeper.secretKey,
      BOT_LV2_GAS_KEY: bot2.secretKey,
      BOT_LV2_ACCOUNT_ID: 'trend2.bots.hairto.testnet',
    });
    expect(near.botLevels()).toEqual([2]);
    expect(near.accountOf('bot:2')).toBe('trend2.bots.hairto.testnet');
    expect(near.accountOf('pusher')).toBe('pusher.hairto.testnet');
    const lanes = near.laneStats();
    expect(lanes.pusher).toMatchObject({ size: 4, inUse: 0 });
    expect(lanes['bot:2']).toMatchObject({ size: 8 });
    expect(lanes.keeper).toBeUndefined();
    expect(near.publicKeyOf('bot:2')).toBe(bot2.publicKey.toString());
  });

  it('signs vault calls with the keeper vault key and arena calls with the keeper key', () => {
    const near = service({ KEEPER_KEY: keeper.secretKey, KEEPER_VAULT_KEY: keeperVault.secretKey });
    expect(near.publicKeyOf('keeper', 'vault.hairto.testnet')).toBe(
      keeperVault.publicKey.toString(),
    );
    expect(near.publicKeyOf('keeper', 'arena.hairto.testnet')).toBe(keeper.publicKey.toString());
    const single = service({ KEEPER_KEY: keeper.secretKey });
    expect(single.publicKeyOf('keeper', 'vault.hairto.testnet')).toBe(keeper.publicKey.toString());
  });

  it('refuses to send for a role without a key', async () => {
    await expect(service().call('keeper', 'arena.hairto.testnet', 'settle_duel')).rejects.toThrow(
      'no key configured for keeper',
    );
  });
});

describe('decodeOutcome', () => {
  it('decodes a JSON return value', () => {
    const value = Buffer.from(JSON.stringify({ duel_id: 7 })).toString('base64');
    expect(decodeOutcome('start', outcome({ SuccessValue: value }))).toMatchObject({
      txHash: 'TxHash111',
      value: { duel_id: 7 },
    });
    expect(decodeOutcome('push_ticks', outcome({ SuccessValue: '' })).value).toBeUndefined();
  });

  it('throws on a failed transaction or receipt, with the panic message', () => {
    const panic = {
      ActionError: { kind: { FunctionCallError: { ExecutionError: 'duel not over' } } },
    };
    expect(() => decodeOutcome('reveal_bot_seed', outcome({ Failure: panic }))).toThrow(
      /reveal_bot_seed failed \(TxHash111\): duel not over/,
    );
    expect(() =>
      decodeOutcome(
        'settle_duel',
        outcome({ SuccessValue: '' }, [{ SuccessValue: '' }, { Failure: panic }]),
      ),
    ).toThrow(NearCallError);
  });
});
