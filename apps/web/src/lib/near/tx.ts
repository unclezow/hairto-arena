import type { NearWalletBase } from '@hot-labs/near-connect';
import type { NearConfig } from './config';
import { transactionCompleted } from './transactions';

/** One function call the player approves in the wallet. Gas in Tgas, deposit in yoctoNEAR. */
export interface WalletCall {
  receiverId: string;
  method: string;
  args: object;
  gasTgas: number;
  deposit: string;
}

const ONE_TGAS = 1_000_000_000_000n;

const actionsOf = (call: WalletCall) => [
  {
    type: 'FunctionCall' as const,
    params: {
      methodName: call.method,
      args: call.args,
      gas: (BigInt(call.gasTgas) * ONE_TGAS).toString(),
      deposit: call.deposit,
    },
  },
];

/**
 * Sends one or more transactions through the connected wallet and returns their outcomes in order. Several
 * transactions go in one approval when the wallet supports `signAndSendTransactions`; otherwise they are sent one by
 * one, each waiting for the previous, so a registration always lands before the transfer that needs it.
 */
export async function walletSend(
  config: NearConfig,
  accountId: string,
  wallet: NearWalletBase,
  calls: WalletCall[],
): Promise<unknown[]> {
  if (calls.length === 0) return [];
  try {
    if (calls.length > 1 && wallet.manifest?.features?.signAndSendTransactions) {
      return await wallet.signAndSendTransactions({
        network: config.network,
        signerId: accountId,
        transactions: calls.map((call) => ({ receiverId: call.receiverId, actions: actionsOf(call) })),
      });
    }
    const outcomes: unknown[] = [];
    for (const call of calls) {
      outcomes.push(
        await wallet.signAndSendTransaction({
          network: config.network,
          signerId: accountId,
          receiverId: call.receiverId,
          actions: actionsOf(call),
        }),
      );
    }
    return outcomes;
  } finally {
    transactionCompleted();
  }
}

/** Exact yoctoNEAR strings for the deposits the economy screens attach. */
export const ONE_YOCTO = '1';
export const nearToYocto = (near: string) => {
  const [whole, fraction = ''] = near.split('.');
  return (BigInt(whole!) * 10n ** 24n + BigInt((fraction + '0'.repeat(24)).slice(0, 24))).toString();
};
