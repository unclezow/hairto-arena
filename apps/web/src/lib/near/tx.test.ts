import { describe, expect, it, vi } from 'vitest';
import { nearToYocto, walletSend } from './tx';

const config = { network: 'testnet' as const, rpcUrl: '', explorerUrl: '', contracts: { arena: 'a', vault: 'v', usdc: 'u', characters: 'c' } };
const calls = [
  { receiverId: 'v', method: 'storage_deposit', args: {}, gasTgas: 30, deposit: nearToYocto('0.01') },
  { receiverId: 'u', method: 'ft_transfer_call', args: { amount: '1' }, gasTgas: 100, deposit: '1' },
];

describe('walletSend', () => {
  it('uses one approval when the wallet supports several transactions', async () => {
    const wallet = { manifest: { features: { signAndSendTransactions: true } }, signAndSendTransactions: vi.fn(async () => ['a', 'b']), signAndSendTransaction: vi.fn() };
    expect(await walletSend(config, 'me', wallet as never, calls)).toEqual(['a', 'b']);
    const params = (wallet.signAndSendTransactions.mock.calls as unknown[][])[0]![0] as { transactions: { receiverId: string; actions: { params: { gas: string; deposit: string } }[] }[] };
    expect(params.transactions.map((t) => t.receiverId)).toEqual(['v', 'u']);
    expect(params.transactions[1]!.actions[0]!.params.gas).toBe('100000000000000');
    expect(wallet.signAndSendTransaction).not.toHaveBeenCalled();
  });

  it('falls back to one approval per transaction, in order', async () => {
    const order: string[] = [];
    const wallet = { manifest: { features: { signAndSendTransactions: false } }, signAndSendTransaction: vi.fn(async (p: { receiverId: string }) => { order.push(p.receiverId); return p.receiverId; }) };
    expect(await walletSend(config, 'me', wallet as never, calls)).toEqual(['v', 'u']);
    expect(order).toEqual(['v', 'u']);
  });

  it('converts NEAR to yocto exactly', () => {
    expect(nearToYocto('0.01')).toBe('10000000000000000000000');
    expect(nearToYocto('1')).toBe('1000000000000000000000000');
  });
});
