import { Redis } from 'ioredis';
import pg from 'pg';
import { loadConfig } from './config.js';
import { PgSink } from './db/pg-sink.js';
import { Ingest, type Logger } from './ingest.js';
import { SingleInstanceLock } from './lock.js';
import { NeardataClient } from './neardata/client.js';
import { RateLimiter } from './neardata/rate-limiter.js';
import { TransactionsApi } from './neardata/tx-api.js';

const log: Logger = {
  info: (m) => console.log(JSON.stringify({ level: 'info', at: new Date().toISOString(), msg: m })),
  warn: (m) =>
    console.warn(JSON.stringify({ level: 'warn', at: new Date().toISOString(), msg: m })),
};

/** The indexer process: holds the lock, creates schema `chain`, then ingests final blocks until stopped. */
async function main() {
  const config = loadConfig();
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
  const lock = new SingleInstanceLock(redis);
  const stop = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop.abort());

  while (!stop.signal.aborted && !(await lock.hold())) {
    log.info('Another indexer holds the lock; waiting');
    await new Promise((r) => setTimeout(r, 10_000));
  }
  const renew = setInterval(() => {
    lock
      .hold()
      .then((held) => {
        if (!held) {
          log.warn('Lost the indexer lock; stopping');
          stop.abort();
        }
      })
      .catch((e: Error) => log.warn(`Lock renewal failed: ${e.message}`));
  }, 10_000);

  const sink = new PgSink(pool, config.schema, log);
  await sink.migrate();
  const limiter = new RateLimiter(config.maxRpm);
  const ingest = new Ingest({
    neardata: new NeardataClient({
      baseUrl: config.neardataUrl,
      apiKey: config.neardataApiKey,
      limiter,
    }),
    txApi: new TransactionsApi({
      baseUrl: config.txApiUrl,
      apiKey: config.neardataApiKey,
      limiter,
    }),
    sink,
    contracts: config.contracts,
    startBlock: config.startBlock,
    gapFillThreshold: config.gapFillThreshold,
    gapFillSafety: config.gapFillSafety,
    resetToHead: config.resetToHead,
    waitMs: config.waitMs,
    log,
  });
  log.info(
    `Indexing ${config.contracts.arena}, ${config.contracts.vault}, ${config.contracts.characters} into schema ` +
      `${config.schema} from ${config.neardataUrl}, at most ${config.maxRpm} requests per minute`,
  );
  try {
    await ingest.run(stop.signal);
  } finally {
    clearInterval(renew);
    await lock.release().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await pool.end();
  }
}

await main();
