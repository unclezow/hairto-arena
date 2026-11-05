import { afterEach, describe, expect, it, vi } from 'vitest';
import { onboardingProgress, reviewedStep, roleDestination, quickPlayPromptSeen, markQuickPlayPromptSeen, MINIMUM_GAS_BALANCE } from './onboarding';
import { parseUnits, formatUnits, formatAmount } from './amount';
import { availableNear } from './near/balances';

afterEach(() => vi.unstubAllGlobals());

describe('onboarding progress', () => {
  const funded = { connected: true, verified: true, nearBalance: MINIMUM_GAS_BALANCE, role: 'none' as const };
  it('connects, verifies, funds, then chooses a role', () => {
    expect(onboardingProgress({ ...funded, connected: false })).toBe(1);
    expect(onboardingProgress({ ...funded, verified: false })).toBe(2);
    expect(onboardingProgress({ ...funded, nearBalance: 0n })).toBe(3);
    expect(onboardingProgress(funded)).toBe(4);
  });
  it('does not skip Fund below the exact minimum', () => {
    expect(onboardingProgress({ ...funded, nearBalance: MINIMUM_GAS_BALANCE - 1n })).toBe(3);
    expect(onboardingProgress(funded)).toBe(4);
  });
  it('waits for account checks rather than treating errors as a funded account', () => {
    expect(onboardingProgress({ ...funded, nearBalance: undefined })).toBe(2);
    expect(onboardingProgress({ ...funded, role: undefined })).toBe(2);
  });
  it('skips Role for registered players and routes by role', () => {
    expect(onboardingProgress({ ...funded, role: 'fighter' })).toBe(5);
    expect(onboardingProgress({ ...funded, role: 'backer' })).toBe(5);
    expect(roleDestination('fighter')).toBe('/play/lobby');
    expect(roleDestination('backer')).toBe('/play/backer');
  });
  it('reviews finished steps and never jumps ahead', () => {
    expect(reviewedStep(4, 1)).toBe(1);
    expect(reviewedStep(4, 3)).toBe(3);
    expect(reviewedStep(2, 4)).toBe(2);
    expect(reviewedStep(4, null)).toBe(4);
  });
  it('scopes the one-time quick-play decision to account and network', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key), setItem: (key: string, value: string) => data.set(key, value) });
    expect(quickPlayPromptSeen('testnet', 'a.testnet')).toBe(false);
    markQuickPlayPromptSeen('testnet', 'a.testnet');
    expect(quickPlayPromptSeen('testnet', 'a.testnet')).toBe(true);
    expect(quickPlayPromptSeen('mainnet', 'a.testnet')).toBe(false);
    expect(quickPlayPromptSeen('testnet', 'b.testnet')).toBe(false);
  });
});

describe('precise balance values', () => {
  it('keeps boundary values exact and accounts for storage reserves', () => {
    expect(parseUnits('0.049999999999999999999999', 24)).toBe(MINIMUM_GAS_BALANCE - 1n);
    expect(availableNear({ amount: MINIMUM_GAS_BALANCE.toString(), locked: '0', storage_usage: 1 })).toBeLessThan(MINIMUM_GAS_BALANCE);
    expect(availableNear({ amount: MINIMUM_GAS_BALANCE.toString(), locked: (10n ** 19n).toString(), storage_usage: 1 })).toBe(MINIMUM_GAS_BALANCE);
    expect(availableNear({ amount: '1', locked: '0', storage_usage: 1 })).toBe(0n);
  });
  it('formats large token quantities without converting to floating point', () => {
    expect(formatUnits(parseUnits('12345678901234567890.123456', 6), 6)).toBe('12345678901234567890.123456');
    expect(formatAmount(parseUnits('12345678901234567890.123456', 6), 6)).toBe('12,345,678,901,234,567,890.12');
    expect(() => parseUnits('1.0000001', 6)).toThrow('decimal');
  });
});
