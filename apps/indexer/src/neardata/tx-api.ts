import type { Fetch } from './client.js';
import type { RateLimiter } from './rate-limiter.js';

export interface AccountTx {
  transaction_hash: string;
  tx_block_height: number;
}

export interface TransactionsApiOptions {
  /** `https://tx.test.fastnear.com` */
  baseUrl: string;
  apiKey?: string;
  limiter: RateLimiter;
  fetch?: Fetch;
  pageSize?: number;
}

export class TransactionsApiError extends Error {}

interface AccountPage {
  account_txs?: AccountTx[];
  transactions?: AccountTx[];
  resume_token?: string | null;
}

/**
 * FastNEAR Transactions API: which transactions an account received receipts in, by transaction block height.
 * Used only by gap-fill; every page counts against the same rate budget as Neardata.
 */
export class TransactionsApi {
  private readonly fetch: Fetch;

  constructor(private readonly options: TransactionsApiOptions) {
    this.fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  }

  /** Every transaction in which `accountId` was a receiver, with `from <= tx_block_height <= to`, ascending. */
  async receiverTxs(accountId: string, from: number, to: number): Promise<AccountTx[]> {
    const out: AccountTx[] = [];
    let resume: string | null | undefined;
    for (;;) {
      await this.options.limiter.take();
      const url = new URL('/v0/account', this.options.baseUrl);
      if (this.options.apiKey) url.searchParams.set('apiKey', this.options.apiKey);
      const res = await this.fetch(url.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId,
          is_receiver: true,
          from_tx_block_height: from,
          to_tx_block_height: to,
          desc: false,
          limit: this.options.pageSize ?? 200,
          ...(resume ? { resume_token: resume } : {}),
        }),
      });
      if (!res.ok) throw new TransactionsApiError(`Transactions API: HTTP ${res.status}`);
      const page = (await res.json()) as AccountPage;
      const txs = page.account_txs ?? page.transactions;
      if (!Array.isArray(txs))
        throw new TransactionsApiError('Transactions API: unexpected response');
      out.push(...txs.filter((t) => t.tx_block_height >= from && t.tx_block_height <= to));
      if (!page.resume_token || txs.length === 0) return out;
      resume = page.resume_token;
    }
  }
}
