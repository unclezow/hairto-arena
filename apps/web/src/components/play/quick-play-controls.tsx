'use client';

import { useQuickPlayKey } from '@/hooks/use-quick-play-key';
import { formatUnits } from '@/lib/amount';

export function QuickPlayControls() {
  const quick = useQuickPlayKey();
  const status = quick.status.data;
  const busy = quick.enable.isPending || quick.remove.isPending;
  const active = status?.kind === 'active';
  return <>
    <p className="connect-note" role="status">Quick play: {status?.kind ?? 'checking'}{status && status.kind !== 'missing' ? ` · ${formatUnits(BigInt(status.allowance), 24)} NEAR gas allowance` : ''}</p>
    <button type="button" className="hub-vault-link" disabled={busy || !status?.funded} onClick={() => active ? quick.remove.mutate() : quick.enable.mutate()}>{active ? 'Remove quick play' : status?.kind === 'exhausted' ? 'Re-enable quick play' : 'Enable quick play'}</button>
    {(quick.enable.error || quick.remove.error) && <p className="connect-error" role="alert">{(quick.enable.error ?? quick.remove.error)?.message}</p>}
  </>;
}
