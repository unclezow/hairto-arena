import { afterEach, describe, expect, it, vi } from 'vitest';
import { RpcProxyService } from './rpc-proxy.service.js';

const RPC = 'https://rpc.example?apiKey=secret';
const service = () => new RpcProxyService({ deployment: { rpcUrl: RPC } } as never);

afterEach(() => vi.unstubAllGlobals());

describe('RpcProxyService', () => {
  it('forwards an allowed call to the provider and returns its answer', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const body = { jsonrpc: '2.0', id: 1, method: 'query', params: {} };
    await expect(service().forward(body)).resolves.toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { ok: true },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      RPC,
      expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }),
    );
  });

  it('refuses a method that is not on the list without calling the provider', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      service().forward({ method: 'EXPERIMENTAL_genesis_config' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(service().forward({ id: 1 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a whole batch when one call is not allowed, and an oversized batch', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(
      service().forward([{ method: 'query' }, { method: 'nope' }]),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      service().forward(Array.from({ length: 21 }, () => ({ method: 'query' }))),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(service().forward([])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('answers 503 when the provider is down or fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down');
      }),
    );
    await expect(service().forward({ method: 'status' })).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad gateway', { status: 502 })),
    );
    await expect(service().forward({ method: 'status' })).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });
});
