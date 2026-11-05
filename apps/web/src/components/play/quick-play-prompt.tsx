'use client';

import { useQuickPlayKey } from '@/hooks/use-quick-play-key';
import { useNearWallet } from '@/lib/near/context';
import { markQuickPlayPromptSeen } from '@/lib/onboarding';

export function QuickPlayPrompt({ onDone }: { onDone: () => void }) {
  const { config, accountId } = useNearWallet();
  const quick = useQuickPlayKey();
  const done = () => { if (accountId) markQuickPlayPromptSeen(config.network, accountId); onDone(); };
  const error = quick.enable.error ?? quick.status.error;
  return <>
    <h2>ENABLE QUICK PLAY</h2>
    <p className="connect-note connect-note-center">Approve one limited key for arena play without wallet popups. It can spend up to 0.25 NEAR on gas. Deposits and withdrawals still ask your wallet.</p>
    {error && <p className="connect-error" role="alert">{error.message}</p>}
    {quick.status.data?.funded === false && <p className="connect-note">Fund your account with testnet NEAR first.</p>}
    <button className="connect-primary" type="button" disabled={!quick.status.data?.funded || quick.enable.isPending} onClick={() => quick.enable.mutate(undefined, { onSuccess: done })}>{quick.enable.isPending ? 'CONFIRM IN WALLET…' : 'ENABLE QUICK PLAY'}</button>
    <button className="connect-link" type="button" disabled={quick.enable.isPending} onClick={done}>Not now</button>
  </>;
}
