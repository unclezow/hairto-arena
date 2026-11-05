export type ArenaOutcome = 'win' | 'loss' | 'draw' | 'void';

export function arenaOutcome(
  status: string | null,
  fighter: string | null,
  winner: string | null,
): ArenaOutcome | null {
  if (status === 'voided') return 'void';
  if (status !== 'finished' && status !== 'forfeited') return null;
  if (!fighter) return null;
  if (status === 'forfeited') return 'loss';
  if (!winner) return 'draw';
  return fighter === winner ? 'win' : 'loss';
}
