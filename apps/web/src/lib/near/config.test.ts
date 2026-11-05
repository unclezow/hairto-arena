import { afterEach, expect, it, vi } from 'vitest';
import { fallbackConfig, loadNearConfig, parseNearConfig } from './config';

afterEach(() => vi.unstubAllGlobals());

it('uses deployment defaults when the API is unreachable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network error')));
  await expect(loadNearConfig(new AbortController().signal)).resolves.toEqual(fallbackConfig());
});

it('loads the public API contract ids and RPC without hardcoding them', async () => {
  const config = { ...fallbackConfig(), rpcUrl: 'https://rpc.example', contracts: { ...fallbackConfig().contracts, arena: 'custom.testnet' } };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => config }));
  await expect(loadNearConfig(new AbortController().signal)).resolves.toEqual(config);
});

it('rejects unsupported networks and malformed public config', () => {
  expect(() => parseNearConfig({ ...fallbackConfig(), network: 'mainnet' })).toThrow('testnet only');
  expect(() => parseNearConfig({ ...fallbackConfig(), rpcUrl: 'javascript:bad' })).toThrow('URL');
  expect(() => parseNearConfig({ ...fallbackConfig(), contracts: {} })).toThrow('contract account');
});

it('does not fall back after cancellation', async () => {
  const controller = new AbortController();
  controller.abort();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')));
  await expect(loadNearConfig(controller.signal)).rejects.toThrow('Aborted');
});
