import { Injectable } from '@nestjs/common';
import { badRequest, upstreamUnavailable } from '../common/errors.js';
import { NearService } from '../near/near.service.js';

/** JSON-RPC methods a browser needs to read the chain and submit a signed transaction. Everything else is refused. */
export const ALLOWED_RPC_METHODS: ReadonlySet<string> = new Set([
  'query',
  'block',
  'chunk',
  'status',
  'health',
  'gas_price',
  'tx',
  'EXPERIMENTAL_tx_status',
  'send_tx',
  'broadcast_tx_async',
  'broadcast_tx_commit',
  'validators',
  'changes',
  'EXPERIMENTAL_changes',
  'EXPERIMENTAL_protocol_config',
]);

const MAX_BATCH = 20;
const UPSTREAM_TIMEOUT_MS = 15_000;

/**
 * Forwards browser JSON-RPC calls to the NEAR RPC provider. The provider key stays on the server: clients only
 * ever see this endpoint, never the upstream URL.
 */
@Injectable()
export class RpcProxyService {
  constructor(private readonly near: NearService) {}

  async forward(body: unknown): Promise<unknown> {
    const calls = Array.isArray(body) ? body : [body];
    if (calls.length === 0 || calls.length > MAX_BATCH) {
      throw badRequest(`A batch holds 1 to ${MAX_BATCH} calls`);
    }
    for (const call of calls) {
      const method = (call as { method?: unknown } | null)?.method;
      if (typeof method !== 'string' || !ALLOWED_RPC_METHODS.has(method)) {
        throw badRequest('RPC method not allowed', {
          method: typeof method === 'string' ? method : null,
        });
      }
    }

    let res: Response;
    try {
      res = await fetch(this.near.deployment.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      throw upstreamUnavailable('NEAR RPC unreachable');
    }
    if (!res.ok && res.status !== 400)
      throw upstreamUnavailable('NEAR RPC error', { status: res.status });
    try {
      return await res.json();
    } catch {
      throw upstreamUnavailable('NEAR RPC returned an invalid response');
    }
  }
}
