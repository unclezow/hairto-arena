export type PlayerRole = 'none' | 'fighter' | 'backer';
export const MINIMUM_GAS_BALANCE = 50_000_000_000_000_000_000_000n;
export interface OnboardingState { connected: boolean; verified: boolean; nearBalance: bigint | undefined; role: PlayerRole | undefined }
/** Five means the four visible onboarding steps are complete. */
export function onboardingProgress(state: OnboardingState): 1 | 2 | 3 | 4 | 5 {
  if (!state.connected) return 1;
  if (!state.verified || state.nearBalance === undefined) return 2;
  if (state.nearBalance < MINIMUM_GAS_BALANCE) return 3;
  if (state.role === undefined) return 2;
  if (state.role === 'none') return 4;
  return 5;
}
export function reviewedStep(progress: number, review: number | null) { return review !== null && review < progress ? review : Math.min(progress, 4); }
export const roleDestination = (role: PlayerRole) => role === 'backer' ? '/play/backer' : '/play/lobby';
const promptKey = (network: string, accountId: string) => `hairto:quick-play-prompt:${network}:${accountId}`;
export function quickPlayPromptSeen(network: string, accountId: string) {
  try { return localStorage.getItem(promptKey(network, accountId)) === 'seen'; } catch { return false; }
}
export function markQuickPlayPromptSeen(network: string, accountId: string) {
  try { localStorage.setItem(promptKey(network, accountId), 'seen'); } catch { /* May be shown again when storage is blocked. */ }
}
