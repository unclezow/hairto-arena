'use client';

import { STABLE_DECIMALS, VAULTS } from '@hairto-arena/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { parseUnits } from '@/lib/amount';
import { useNearWallet } from '@/lib/near/context';
import { economyViews, VAULT_REGISTRATION_NEAR, type Pool } from '@/lib/near/economy';
import { eventsOf, findEvent } from '@/lib/near/outcome';
import { nearToYocto, ONE_YOCTO, walletSend, type WalletCall } from '@/lib/near/tx';
import { useBalances } from './use-balances';

export type VaultAction = 'claim' | 'deposit' | 'withdraw' | 'claimYield';
export const FIGHTER_MINIMUM = parseUnits(String(VAULTS.fighter.minDepositUsd), STABLE_DECIMALS);
export const BACKER_MINIMUM = parseUnits(String(VAULTS.backer.minDepositUsd), STABLE_DECIMALS);

/** Deposit refusals from `vault_deposit_rejected`, in the dialog's words. */
export function rejectionText(reason: string, pool: Pool) {
  const other = pool === 'Fighter' ? 'Backer' : 'Fighter';
  const minimum = pool === 'Fighter' ? VAULTS.fighter.minDepositUsd : VAULTS.backer.minDepositUsd;
  const text: Record<string, string> = {
    below_minimum: `The ${pool} pool needs at least ${minimum} USDC.`,
    role_conflict: `This account is already a ${other}.`,
    paused: 'Deposits are paused.',
    not_registered: 'The vault registration did not land. Try again.',
    bad_msg: 'The vault could not read the deposit.',
  };
  return `${text[reason] ?? 'The vault refused the deposit.'} Your USDC was returned to your wallet.`;
}

const firstLine = (err: unknown) => ((err as Error)?.message ?? 'Transaction failed').split('\n')[0]!;

/**
 * The account's USDC (mock) and its deposit in one vault pool: Get USDC from the faucet, deposit with
 * `ft_transfer_call` (registering with the vault in the same approval the first time), withdraw, and claim Backer
 * yield. Each result is read from the contracts' events, so a refunded deposit never looks like a success.
 */
export function useVault(pool: Pool = 'Fighter') {
  const { config, accountId, wallet } = useNearWallet();
  const queries = useQueryClient();
  const balances = useBalances();
  const views = economyViews(config);
  const [busy, setBusy] = useState<VaultAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reads = useQuery({
    queryKey: ['vault', pool, config.contracts.vault, accountId],
    enabled: !!accountId,
    refetchInterval: 15_000,
    queryFn: async () => {
      const [principal, yieldEarned, faucet] = await Promise.all([
        views.principalOf(pool, accountId!),
        views.claimableYieldOf(accountId!),
        views.faucetInfo(accountId!).catch(() => null),
      ]);
      return { principal, yieldEarned, nextClaimMs: faucet?.next_claim_ms ?? 0 };
    },
  });

  const run = useCallback(
    async (action: VaultAction, calls: () => Promise<WalletCall[]>, check: (outcomes: unknown[]) => string | null) => {
      if (!accountId || !wallet) return false;
      setBusy(action);
      setError(null);
      try {
        const outcomes = await walletSend(config, accountId, wallet, await calls());
        const problem = check(outcomes);
        if (problem) setError(problem);
        return !problem;
      } catch (err) {
        setError(firstLine(err));
        return false;
      } finally {
        setBusy(null);
        await Promise.all([balances.refresh(), queries.invalidateQueries({ queryKey: ['vault'] })]);
      }
    },
    [accountId, balances, config, queries, wallet],
  );

  const vaultEvents = (outcomes: unknown[]) => outcomes.flatMap((o) => eventsOf(o, config.contracts.vault));

  /** Get USDC: registers with the token on the first claim (storage minimum attached). */
  const claim = useCallback(
    () =>
      run(
        'claim',
        async () => {
          const registered = await views.usdcRegistered(accountId!);
          const deposit = registered ? '0' : await views.usdcStorageMin();
          return [{ receiverId: config.contracts.usdc, method: 'faucet', args: {}, gasTgas: 30, deposit }];
        },
        () => null,
      ),
    [accountId, config, run, views],
  );

  const deposit = useCallback(
    (amount: bigint) =>
      run(
        'deposit',
        async () => {
          const calls: WalletCall[] = [];
          if (!(await views.vaultRegistered(accountId!)))
            calls.push({
              receiverId: config.contracts.vault,
              method: 'storage_deposit',
              args: {},
              gasTgas: 30,
              deposit: nearToYocto(VAULT_REGISTRATION_NEAR),
            });
          calls.push({
            receiverId: config.contracts.usdc,
            method: 'ft_transfer_call',
            args: { receiver_id: config.contracts.vault, amount: amount.toString(), msg: JSON.stringify({ pool }) },
            gasTgas: 100,
            deposit: ONE_YOCTO,
          });
          return calls;
        },
        (outcomes) => {
          const events = vaultEvents(outcomes);
          const rejected = findEvent(events, 'vault_deposit_rejected');
          if (rejected) return rejectionText(rejected.reason, pool);
          return findEvent(events, 'vault_deposited') ? null : 'The deposit was not confirmed. Check your balance.';
        },
      ),
    [accountId, config, pool, run, views],
  );

  const withdraw = useCallback(
    (amount: bigint) =>
      run(
        'withdraw',
        async () => [
          {
            receiverId: config.contracts.vault,
            method: 'withdraw',
            args: { pool, amount: amount.toString() },
            gasTgas: 50,
            deposit: ONE_YOCTO,
          },
        ],
        (outcomes) =>
          findEvent(vaultEvents(outcomes), 'vault_withdraw_failed')
            ? 'Withdrawal failed, your deposit is unchanged.'
            : null,
      ),
    [config, pool, run],
  );

  const claimYield = useCallback(
    () =>
      run(
        'claimYield',
        async () => [
          { receiverId: config.contracts.vault, method: 'claim_yield', args: {}, gasTgas: 50, deposit: ONE_YOCTO },
        ],
        (outcomes) =>
          findEvent(vaultEvents(outcomes), 'vault_claim_failed') ? 'Yield claim failed, try again.' : null,
      ),
    [config, run],
  );

  const principal = reads.data?.principal ?? 0n;
  const minimum = pool === 'Fighter' ? FIGHTER_MINIMUM : BACKER_MINIMUM;
  return {
    wallet: balances.usdc,
    principal,
    yieldEarned: reads.data?.yieldEarned ?? 0n,
    /** Unix seconds when the faucet can be claimed again; 0 when it can be claimed now. */
    nextClaimAt: Math.ceil((reads.data?.nextClaimMs ?? 0) / 1000),
    canPlay: pool === 'Fighter' && principal >= FIGHTER_MINIMUM,
    eligible: principal >= minimum,
    busy,
    error,
    claim,
    deposit,
    withdraw,
    claimYield,
  };
}
